/**
 * `vercel` agent harness — a multi-turn tool-calling loop driven by the
 * Vercel AI SDK (`streamText`) with guardrails wired into each tool's
 * `execute` callback.
 *
 * The Vercel AI SDK runs the multi-step tool loop internally when `tools`
 * and `stopWhen: stepCountIs(N)` are set. KOTA exposes its tool registry
 * to the SDK as a Vercel `ToolSet` whose `execute` functions enforce
 * `disallowedTools`, `allowedTools`, and `canUseTool` before delegating to
 * `executeTool`. Streamed text chunks flow to the optional
 * `AgentHarnessWriter` via the SDK's `onChunk` callback.
 *
 * Provider routing is `<providerKey>/<modelId>`. Today the adapter ships
 * an `openai` provider built from `@ai-sdk/openai`. Operators that want a
 * different provider extend `VERCEL_PROVIDER_REGISTRY` with their installed
 * `@ai-sdk/<vendor>` package; the adapter throws loudly on unknown keys
 * rather than silently falling back.
 */

import type { LanguageModel, ModelMessage, streamText, ToolSet } from "ai";

/**
 * Structural alias for the SDK's `ProviderOptions` (`SharedV3ProviderOptions`),
 * which is not re-exported from the top-level `ai` module. Defined here so the
 * adapter does not need to import from `@ai-sdk/provider-utils` (a transitive
 * dependency that the project does not list directly in `package.json`).
 */
type ProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

/**
 * Lazy `ai` import. The `ai` package transitively imports `eventsource-parser`,
 * whose package exports point its `source` condition at `.ts` source files
 * inside `node_modules` — Node's experimental TypeScript stripping refuses
 * those, so importing `ai` at module-load time crashes any test runner that
 * sets `--conditions=source` (the standard mode for KOTA's own internal
 * imports). Loading `ai` only when a run actually starts keeps module
 * discovery free of that side-effect.
 */
async function loadAiSdk(): Promise<typeof import("ai")> {
  return import("ai");
}

import type {
  AgentCanUseTool,
  AgentEffort,
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaTool,
} from "#core/agent-harness/index.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import { executeTool, getAllTools } from "#core/tools/index.js";

export const VERCEL_AGENT_HARNESS_NAME = "vercel";
export const VERCEL_ASK_OWNER_TOOL_NAME = "ask_owner";

const DEFAULT_MAX_TURNS = 25;

type ProviderFactory = (modelId: string) => Promise<LanguageModel>;

/**
 * Provider registry. Keys are the `<providerKey>` prefix in `model`.
 * Factories are async so the adapter can lazy-load the `@ai-sdk/<vendor>`
 * package only when a run actually needs that provider — keeps the
 * adapter's module-load cost low and avoids pulling in a vendor SDK's
 * source tree (and its transitive deps) unless an operator selects the
 * vendor at runtime.
 */
const VERCEL_PROVIDER_REGISTRY: Record<string, ProviderFactory> = {
  openai: async (modelId: string) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI()(modelId);
  },
};

async function resolveLanguageModel(modelString: string): Promise<{
  provider: string;
  model: LanguageModel;
}> {
  const slash = modelString.indexOf("/");
  if (slash <= 0 || slash === modelString.length - 1) {
    throw new Error(
      `The "vercel" agent harness expects model in "<provider>/<modelId>" form, got "${modelString}".`,
    );
  }
  const provider = modelString.slice(0, slash);
  const modelId = modelString.slice(slash + 1);
  const factory = VERCEL_PROVIDER_REGISTRY[provider];
  if (!factory) {
    throw new Error(
      `The "vercel" agent harness has no provider "${provider}" registered. ` +
        `Install @ai-sdk/${provider} and extend VERCEL_PROVIDER_REGISTRY, ` +
        `or use one of: ${Object.keys(VERCEL_PROVIDER_REGISTRY).join(", ")}.`,
    );
  }
  const model = await factory(modelId);
  return { provider, model };
}

function mapEffortToProviderOptions(
  provider: string,
  effort: AgentEffort,
): ProviderOptions {
  if (provider === "openai") {
    const reasoningEffort: "low" | "medium" | "high" =
      effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
    return { openai: { reasoningEffort } };
  }
  throw new Error(
    `The "vercel" agent harness has no reasoning-effort mapping for provider "${provider}" ` +
      `(effort="${effort}"). Extend mapEffortToProviderOptions or run claude-agent-sdk.`,
  );
}

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "vercel" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "vercel" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "vercel" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "vercel" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["vercel"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "vercel" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "vercel" agent harness does not host extended thinking. ' +
        'Drop thinkingEnabled/thinkingBudget — use the portable "effort" field, ' +
        "or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "vercel" agent harness does not emit KotaAgentMessage frames. ' +
        "Drop onMessage or run claude-agent-sdk.",
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectToolDefinitions(
  allowed: readonly string[] | undefined,
  disallowed: readonly string[] | undefined,
  includeAskOwner: boolean,
): KotaTool[] {
  const all = getAllTools();
  const denySet = new Set(disallowed ?? []);
  const allowSet = allowed && allowed.length > 0 ? new Set(allowed) : null;
  if (includeAskOwner && allowSet) allowSet.add(VERCEL_ASK_OWNER_TOOL_NAME);
  return all.filter((t) => {
    if (denySet.has(t.name)) return false;
    if (allowSet && !allowSet.has(t.name)) return false;
    return true;
  });
}

type LoopFlags = {
  interrupted: boolean;
  interruptMessage: string;
};

function buildVercelToolSet(
  ai: typeof import("ai"),
  kotaTools: readonly KotaTool[],
  guardrails: {
    canUseTool: AgentCanUseTool | undefined;
    abortSignal: AbortSignal | undefined;
  },
  flags: LoopFlags,
  internalAbort: AbortController,
): ToolSet {
  const tools: ToolSet = {};

  for (const kotaTool of kotaTools) {
    tools[kotaTool.name] = ai.dynamicTool({
      description: kotaTool.description,
      inputSchema: ai.jsonSchema(
        kotaTool.input_schema as Parameters<typeof ai.jsonSchema>[0],
      ),
      execute: async (input, _options) => {
        if (!isPlainRecord(input)) {
          throw new Error(
            `vercel adapter: tool "${kotaTool.name}" received non-object input ` +
              `(${input === null ? "null" : Array.isArray(input) ? "array" : typeof input}); ` +
              "the SDK should validate against inputSchema before reaching execute.",
          );
        }

        let effectiveInput: Record<string, unknown> = input;
        if (guardrails.canUseTool) {
          const toolAbort = new AbortController();
          if (guardrails.abortSignal) {
            if (guardrails.abortSignal.aborted) {
              toolAbort.abort(guardrails.abortSignal.reason);
            } else {
              guardrails.abortSignal.addEventListener(
                "abort",
                () => toolAbort.abort(guardrails.abortSignal?.reason),
                { once: true },
              );
            }
          }
          const decision = await guardrails.canUseTool(kotaTool.name, input, {
            signal: toolAbort.signal,
            suggestions: [],
            toolUseId: _options.toolCallId,
          });
          if (decision.behavior === "deny") {
            if (decision.interrupt === true) {
              flags.interrupted = true;
              flags.interruptMessage = decision.message;
              internalAbort.abort(
                new Error(`canUseTool interrupted the loop: ${decision.message}`),
              );
              return { isError: true, content: decision.message };
            }
            return { isError: true, content: decision.message };
          }
          if (
            decision.behavior === "allow" &&
            isPlainRecord(decision.updatedInput)
          ) {
            effectiveInput = decision.updatedInput;
          }
        }

        const result = await executeTool(kotaTool.name, effectiveInput);
        return {
          isError: result.is_error === true,
          content: result.content,
        };
      },
    });
  }
  return tools;
}

function buildMessages(prompt: string): ModelMessage[] {
  return [{ role: "user", content: prompt }];
}

export const vercelAgentHarness: AgentHarness = {
  name: VERCEL_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop on the Vercel AI SDK (streamText + tools + stopWhen=stepCountIs). Honors canUseTool, allowedTools, disallowedTools.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: VERCEL_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: false,
  toolControl: "kota",
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    if (options.askOwner) {
      return runWithAskOwnerSource(options.askOwner.source, () =>
        runVercelLoop(options, writer),
      );
    }
    return runVercelLoop(options, writer);
  },
};

async function runVercelLoop(
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  rejectUnsupportedOptions(options);
  if (!options.model) {
    throw new Error(
      'The "vercel" agent harness requires an explicit model on the step or config.',
    );
  }
  if (options.abortController?.signal.aborted) {
    const reason = options.abortController.signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }

  const ai = await loadAiSdk();
  const { provider, model: resolvedModel } = await resolveLanguageModel(
    options.model,
  );
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const kotaTools = selectToolDefinitions(
    options.allowedTools,
    options.disallowedTools,
    options.askOwner !== undefined,
  );

  const internalAbort = new AbortController();
  if (options.abortController) {
    if (options.abortController.signal.aborted) {
      internalAbort.abort(options.abortController.signal.reason);
    } else {
      options.abortController.signal.addEventListener(
        "abort",
        () => internalAbort.abort(options.abortController?.signal.reason),
        { once: true },
      );
    }
  }

  const flags: LoopFlags = { interrupted: false, interruptMessage: "" };
  const tools = buildVercelToolSet(
    ai,
    kotaTools,
    {
      canUseTool: options.canUseTool,
      abortSignal: options.abortController?.signal,
    },
    flags,
    internalAbort,
  );

  const streamedChunks: string[] = [];
  const providerOptions = mapEffortToProviderOptions(provider, options.effort);

  let result: ReturnType<typeof streamText>;
  try {
    result = ai.streamText({
      model: resolvedModel,
      messages: buildMessages(options.prompt),
      ...(options.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
      stopWhen: ai.stepCountIs(maxTurns),
      abortSignal: internalAbort.signal,
      providerOptions,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta" && typeof chunk.text === "string") {
          streamedChunks.push(chunk.text);
          if (writer) writer.write(chunk.text);
        }
      },
    });
  } catch (err) {
    if (flags.interrupted) {
      return interruptedResult(flags, streamedChunks);
    }
    throw err;
  }

  let finalText: string;
  let totalUsage: Awaited<typeof result.totalUsage>;
  let steps: Awaited<typeof result.steps>;
  let finishReason: Awaited<typeof result.finishReason>;
  try {
    finalText = await result.text;
    totalUsage = await result.totalUsage;
    steps = await result.steps;
    finishReason = await result.finishReason;
  } catch (err) {
    if (flags.interrupted) {
      return interruptedResult(flags, streamedChunks);
    }
    throw err;
  }

  const turns = steps.length;
  const inputTokens = totalUsage.inputTokens ?? 0;
  const outputTokens = totalUsage.outputTokens ?? 0;
  const lastSessionId =
    steps.length > 0 ? steps[steps.length - 1]?.response.id : undefined;

  if (turns >= maxTurns && finishReason === "tool-calls") {
    return {
      text:
        finalText ||
        `vercel harness reached maxTurns=${maxTurns} without ending.`,
      streamedText: streamedChunks.join(""),
      ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
      turns,
      inputTokens,
      outputTokens,
      isError: true,
      subtype: "max_turns_reached",
    };
  }

  return {
    text: finalText,
    streamedText: streamedChunks.join(""),
    ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
    turns,
    inputTokens,
    outputTokens,
    isError: false,
  };
}

function interruptedResult(
  flags: LoopFlags,
  streamedChunks: string[],
): AgentHarnessResult {
  const message = `canUseTool interrupted the loop: ${flags.interruptMessage}`;
  return {
    text: message,
    streamedText: streamedChunks.join(""),
    turns: 1,
    inputTokens: 0,
    outputTokens: 0,
    isError: true,
    subtype: "interrupted_by_can_use_tool",
  };
}
