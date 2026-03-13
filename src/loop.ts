import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { allTools, executeTool } from "./tools/index.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { runArchitectPass, runEditorLoop } from "./architect.js";
import { setDelegateModel } from "./tools/delegate.js";

const SYSTEM_PROMPT = `You are KOTA, an expert AI coding agent. You help users with software engineering tasks: writing code, fixing bugs, refactoring, exploring codebases, and more.

## How you work
- You have access to tools for reading, writing, editing files, running shell commands, searching code, and tracking tasks.
- Break complex tasks into steps using the todo tool.
- Read files before editing them. Understand existing code before modifying.
- After making changes, verify they work (run tests, type checks, builds).
- Be concise. Lead with the answer, not the reasoning.

## Tool usage
- Use file_read to read files (not shell + cat).
- Use file_edit for modifying existing files (search-and-replace).
- Use file_write only for creating new files.
- Use grep to search code content, glob to find files by pattern.
- Use shell for builds, tests, git commands, installs.

## Safety
- Never run destructive commands without confirming.
- Never modify files outside the project directory.
- If you're stuck after 3 attempts, explain the situation and ask for help.`;

const MAX_ITERATIONS = 200;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const TOKEN_THRESHOLD = 150_000; // For verbose display — matches context.ts threshold

export type LoopOptions = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  verbose?: boolean;
  architectMode?: boolean;
  sessionPath?: string;
};

/** Build system prompt as cacheable content blocks */
function systemBlocks(text: string): Anthropic.Messages.TextBlockParam[] {
  return [
    { type: "text", text, cache_control: { type: "ephemeral" } },
  ];
}

export async function runAgentLoop(
  prompt: string,
  options: LoopOptions = {},
): Promise<string> {
  const model = options.model || "claude-sonnet-4-6";
  const editorModel = options.editorModel || model;
  const maxTokens = options.maxTokens || 8192;
  const verbose = options.verbose || false;

  const client = new Anthropic();
  const costTracker = new CostTracker();
  const sessionPath = options.sessionPath;

  // Load or create context
  let context: Context;
  if (sessionPath && existsSync(sessionPath)) {
    context = Context.load(sessionPath, SYSTEM_PROMPT);
    context.addUserMessage(prompt);
    if (verbose) console.error(`[kota] Resumed session from ${sessionPath}`);
  } else {
    context = new Context(SYSTEM_PROMPT);
    context.addUserMessage(prompt);
  }

  // SIGINT handler: save session before exit
  const sigintHandler = () => {
    if (sessionPath) {
      context.save(sessionPath);
      console.error(`\n[kota] Session saved to ${sessionPath}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", sigintHandler);

  // Configure delegate sub-agent model
  setDelegateModel(editorModel);

  let lastResult = "";

  // Architect/Editor split: two-pass before the main verification loop
  if (options.architectMode) {
    const plan = await runArchitectPass(
      client, model, maxTokens,
      context.getSystemPrompt(), context.getMessages(), verbose,
    );
    if (plan) {
      const editorResult = await runEditorLoop(
        client, editorModel, maxTokens, plan, verbose,
      );
      lastResult = editorResult || plan;
      // Inject summary so the verification loop knows what happened
      context.addAssistantText(
        `[Architect/Editor completed]\n\nPlan executed:\n${plan.slice(0, 500)}` +
        (editorResult ? `\n\nEditor result: ${editorResult}` : ""),
      );
      context.addUserMessage(
        "The architect/editor has made changes. " +
        "Verify they are correct: run builds, tests, or type checks as appropriate.",
      );
    }
  }

  let consecutiveFailures = 0;
  let lastFailureSignature = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Compact if needed
    if (context.needsCompaction()) {
      if (verbose) console.error("[kota] Compacting context...");
      await context.compact(client, model);
    }

    if (verbose) {
      const stats = context.getStats();
      console.error(`[kota] Turn ${i + 1} (${stats.turns} messages, ${stats.compactions} compactions)`);
    }

    // Stream the response with prompt caching enabled
    let streamedText = "";
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: systemBlocks(context.getSystemPrompt()),
      tools: allTools,
      messages: context.getMessages(),
    });

    stream.on("text", (text) => {
      process.stdout.write(text);
      streamedText += text;
    });

    const response = await stream.finalMessage();
    if (streamedText) {
      process.stdout.write("\n");
      lastResult = streamedText;
    }

    // Track token usage for compaction decisions and cost
    context.setInputTokens(response.usage.input_tokens);
    costTracker.addUsage(model, response.usage);
    console.error(`[kota] Turn ${i + 1} \u2014 ${costTracker.getSummary()}`);

    // Log cache and token stats in verbose mode
    if (verbose) {
      const u = response.usage;
      console.error(
        `[kota] Tokens: input=${u.input_tokens}/${TOKEN_THRESHOLD}` +
        (u.cache_read_input_tokens ? `, cache_read=${u.cache_read_input_tokens}` : "") +
        (u.cache_creation_input_tokens ? `, cache_created=${u.cache_creation_input_tokens}` : ""),
      );
    }

    context.addAssistantMessage(response);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      if (toolUseBlocks.length === 0) break;
    }

    // Execute tool calls (in parallel when possible)
    if (toolUseBlocks.length > 0) {
      const results = await Promise.all(
        toolUseBlocks.map(async (block) => {
          if (block.type !== "tool_use") return null;
          if (verbose) {
            console.error(`[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`);
          }
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
          );
          return {
            tool_use_id: block.id,
            content: result.content,
            is_error: result.is_error,
          };
        }),
      );

      const validResults = results.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );
      context.addToolResults(validResults);

      // Auto-save session after every turn
      if (sessionPath) context.save(sessionPath);

      // Circuit breaker: detect repeated identical failures
      const failedResults = validResults.filter((r) => r.is_error);
      if (failedResults.length > 0) {
        const sig = failedResults.map((r) => r.content).join("|");
        if (sig === lastFailureSignature) {
          consecutiveFailures++;
          if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
            console.error(
              `[kota] Circuit breaker: ${CIRCUIT_BREAKER_THRESHOLD} identical failures. Stopping.`,
            );
            context.addUserMessage(
              "You have failed the same way 3 times in a row. " +
              "Stop and explain what's going wrong.",
            );
          }
        } else {
          consecutiveFailures = 1;
          lastFailureSignature = sig;
        }
      } else {
        consecutiveFailures = 0;
        lastFailureSignature = "";
      }
    }

    // If stop_reason is "end_turn" with no pending tool calls, done
    if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
      break;
    }
  }

  // Clean up SIGINT handler and save final state
  process.removeListener("SIGINT", sigintHandler);
  if (sessionPath) context.save(sessionPath);

  console.error(`[kota] Done \u2014 ${costTracker.getSummary()}`);
  return lastResult;
}
