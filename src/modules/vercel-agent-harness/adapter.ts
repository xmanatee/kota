import type { ModelMessage } from "ai";
import {
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessRunOptions,
  type AgentHarnessWriter,
  agentHarnessToolExecutionOptions,
  UNKNOWN_AGENT_USAGE,
  unpricedAgentUsage,
} from "#core/agent-harness/index.js";
import { runWithAskOwnerSource } from "#core/tools/ask-owner.js";
import {
  rejectUnsupportedOptions,
  VERCEL_UNSUPPORTED_OPTIONS,
} from "./adapter-options.js";
import {
  loadAiSdk,
  mapEffortToProviderOptions,
  resolveLanguageModel,
} from "./adapter-providers.js";
import {
  buildVercelToolSet,
  type LoopFlags,
  selectToolDefinitions,
  VERCEL_ASK_OWNER_TOOL_NAME,
} from "./adapter-tools.js";

export const VERCEL_AGENT_HARNESS_NAME = "vercel";

const DEFAULT_MAX_TURNS = 25;

function buildMessages(prompt: string): ModelMessage[] {
  return [{ role: "user", content: prompt }];
}

function finiteNonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
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
  unsupportedRunOptions: VERCEL_UNSUPPORTED_OPTIONS,
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
    agentHarnessToolExecutionOptions(options, { resultLimit: 50_000 }),
    flags,
    internalAbort,
  );

  const streamedChunks: string[] = [];
  const providerOptions = mapEffortToProviderOptions(provider, options.effort);

  let result: ReturnType<typeof ai.streamText>;
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
  const inputTokens = finiteNonNegativeInteger(totalUsage.inputTokens);
  const outputTokens = finiteNonNegativeInteger(totalUsage.outputTokens);
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
      usage: unpricedAgentUsage(inputTokens, outputTokens),
      isError: true,
      subtype: "max_turns_reached",
    };
  }

  return {
    text: finalText,
    streamedText: streamedChunks.join(""),
    ...(lastSessionId !== undefined ? { sessionId: lastSessionId } : {}),
    turns,
    usage: unpricedAgentUsage(inputTokens, outputTokens),
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
    usage: UNKNOWN_AGENT_USAGE,
    isError: true,
    subtype: "interrupted_by_can_use_tool",
  };
}
