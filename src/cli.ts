import { Command } from "commander";
import { registerAgentCommands, registerSkillCommands } from "./agent-cli.js";
import {
  buildClaudeCodeSystemPrompt,
  executeWithAgentSDK,
} from "./agent-sdk/index.js";
import { registerApprovalCommands } from "./approval-cli.js";
import {
  interactiveMode,
  parseIntOption,
  registerHistoryCommands,
  resolveConversationId,
  runPipeLoop,
} from "./cli-history.js";
import { expandAlias, loadConfig } from "./config.js";
import { registerConfigCommands } from "./config-cli.js";
import { setSkipConfirmations } from "./confirm.js";
import { registerDoctorCommand } from "./doctor-cli.js";
import { registerExtensionCommands } from "./extension-cli.js";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader } from "./extension-loader.js";
import { builtinExtensions } from "./extensions/index.js";
import { registerInitCommand } from "./init-cli.js";
import { runAgentLoop } from "./loop.js";
import { getHistory } from "./memory/history.js";
import { registerKnowledgeCommands, registerMemoryCommands } from "./memory-cli.js";
import { createModelClient, parseModelString } from "./model/provider-factory.js";
import { registerSessionCommands } from "./session-cli.js";
import { registerTaskCommands } from "./task-cli.js";
import { registerWebhookCommands } from "./webhook-cli.js";
import { registerWorkflowCommands } from "./workflow-cli.js";

export { parseIntOption } from "./cli-history.js";

/** Check if an error is an Anthropic auth error and return a user-friendly message, or null. */
export function formatAuthError(err: Error): string | null {
  const msg = err.message || "";
  if (
    msg.includes("Could not resolve authentication") ||
    msg.includes("apiKey") ||
    msg.includes("authToken") ||
    (err as { status?: number }).status === 401
  ) {
    return [
      "Error: Anthropic API authentication failed.\n",
      "Check that your ANTHROPIC_API_KEY is set and valid:",
      "  export ANTHROPIC_API_KEY=sk-ant-...\n",
      "Get a key at https://console.anthropic.com/settings/keys",
    ].join("\n");
  }
  return null;
}

const program = new Command();

program
  .name("kota")
  .description("KOTA — Keep Only The Awesome. A general-purpose AI agent.")
  .version("0.1.0");

program
  .command("run", { isDefault: true })
  .description("Run KOTA with a prompt")
  .argument("[prompt...]", "The task to perform")
  .option("-m, --model <model>", "Model (default: claude-sonnet-4-6). Supports provider/model notation: ollama/llama3, openai/gpt-4o")
  .option("--provider <name>", "Model provider: anthropic, openai, ollama, groq, together, lmstudio, agent-sdk (Claude Agent SDK)")
  .option("--base-url <url>", "Base URL for OpenAI-compatible provider (overrides preset)")
  .option("--editor-model <model>", "Model for editor pass and sub-agents (defaults to --model)")
  .option("--max-tokens <n>", "Max tokens per response")
  .option("-v, --verbose", "Show debug output")
  .option("-a, --architect", "Enable Architect/Editor split (two-pass reasoning)")
  .option("-i, --interactive", "Interactive mode (REPL)")
  .option("-s, --session <path>", "Session file for persistence/resume")
  .option("-y, --yes", "Skip confirmation prompts for destructive commands")
  .option("-t, --think", "Enable extended thinking for deeper reasoning")
  .option("--think-budget <tokens>", "Thinking budget in tokens (default: 10000, min: 1024)")
  .option("-c, --continue [id]", "Continue most recent conversation (or specify conversation ID)")
  .option("--no-history", "Disable automatic conversation history")
  .option("--no-reflect", "Disable self-reflection before delivering responses")
  .action(async (promptWords: string[], opts) => {
    const parsedMaxTokens = opts.maxTokens ? parseIntOption(opts.maxTokens, "max-tokens") : undefined;
    const parsedThinkBudget = opts.thinkBudget ? parseIntOption(opts.thinkBudget, "think-budget") : undefined;

    const config = loadConfig();

    const providerName = opts.provider || config.modelProvider?.type;
    if (providerName === "agent-sdk") {
      const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
      const { model } = parseModelString(modelSpec);
      let prompt = promptWords.join(" ");
      prompt = expandAlias(prompt, config.aliases);
      if (!prompt) {
        console.error("agent-sdk provider requires a prompt. Interactive mode is not supported.");
        process.exit(1);
      }
      const result = await executeWithAgentSDK(prompt, {
        model,
        verbose: opts.verbose || config.verbose || false,
        cwd: process.cwd(),
        systemPrompt: buildClaudeCodeSystemPrompt(
          config,
          undefined,
          process.cwd(),
          process.cwd(),
        ),
      });
      if (!result.streamedText && result.text) process.stdout.write(result.text);
      console.log();
      return;
    }

    const modelSpec = opts.model || config.model || "claude-sonnet-4-6";
    const resolved = createModelClient({
      model: modelSpec,
      provider: providerName,
      baseUrl: opts.baseUrl || config.modelProvider?.baseUrl,
      apiKey: config.modelProvider?.apiKey,
    });
    const model = resolved.model;
    const editorModel = opts.editorModel || config.editorModel;
    const maxTokens = parsedMaxTokens || config.maxTokens || 8192;
    const verbose = opts.verbose || config.verbose || false;
    const architect = opts.architect || config.architect || false;
    const thinkEnabled = opts.think || config.thinking || false;
    const thinkBudget = parsedThinkBudget
      ? Math.max(1024, parsedThinkBudget)
      : (config.thinkingBudget || 10000);
    const skipConfirm = opts.yes || config.skipConfirmations || false;

    if (skipConfirm) setSkipConfirmations(true);

    let resumeId: string | undefined;
    if (opts.continue) {
      const history = getHistory();
      if (typeof opts.continue === "string") {
        resumeId = resolveConversationId(history, opts.continue);
      } else {
        const recent = history.getMostRecent(process.cwd());
        if (recent) {
          resumeId = recent.id;
        } else {
          console.error("No previous conversation found for this directory.");
          process.exit(1);
        }
      }
    }

    const options = {
      model,
      editorModel,
      maxTokens,
      verbose,
      architectMode: architect,
      sessionPath: opts.session,
      thinkingEnabled: thinkEnabled,
      thinkingBudget: thinkEnabled ? Math.max(1024, thinkBudget) : undefined,
      config,
      resumeConversation: resumeId,
      noHistory: opts.history === false,
      reflectionEnabled: opts.reflect !== false,
      client: resolved.client,
    };

    let prompt = promptWords.join(" ");
    prompt = expandAlias(prompt, config.aliases);

    if (opts.interactive || !prompt) {
      await interactiveMode(options, config);
    } else {
      await runAgentLoop(prompt, options);
    }
  });

registerHistoryCommands(program);
registerWorkflowCommands(program);
registerApprovalCommands(program);
registerTaskCommands(program);
registerMemoryCommands(program);
registerKnowledgeCommands(program);
registerExtensionCommands(program);
registerSessionCommands(program);
registerAgentCommands(program);
registerSkillCommands(program);
registerWebhookCommands(program);
registerDoctorCommand(program);
registerConfigCommands(program);
registerInitCommand(program);

// Handle stdin pipe mode
async function checkPipeMode() {
  if (!process.stdin.isTTY && process.argv.length <= 2) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString());
    }
    const piped = chunks.join("").trim();
    if (piped) {
      const config = loadConfig();

      if (config.modelProvider?.type === "agent-sdk") {
        const modelSpec = config.model || "claude-sonnet-4-6";
        const { model } = parseModelString(modelSpec);
        const result = await executeWithAgentSDK(piped, {
          model,
          verbose: config.verbose,
          cwd: process.cwd(),
          systemPrompt: buildClaudeCodeSystemPrompt(
            config,
            undefined,
            process.cwd(),
            process.cwd(),
          ),
        });
        if (!result.streamedText && result.text) process.stdout.write(result.text);
        console.log();
        return true;
      }

      await runPipeLoop(piped);
      return true;
    }
  }
  return false;
}

async function main() {
  const wasPiped = await checkPipeMode();
  if (wasPiped) return;

  const config = loadConfig();
  const loader = new ExtensionLoader(config, false, { commandsOnly: true });
  const extensions = await discoverExtensions(undefined, false);
  await loader.loadAll([...builtinExtensions, ...extensions]);
  for (const cmd of loader.getCommands()) {
    program.addCommand(cmd);
  }

  await program.parseAsync();
}

main().catch((err) => {
  const authMsg = formatAuthError(err);
  if (authMsg) {
    console.error(authMsg);
  } else {
    console.error(`Fatal: ${err.message}`);
  }
  process.exit(1);
});
