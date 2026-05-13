/**
 * `codex` agent harness — a multi-turn tool-calling loop driven by the
 * OpenAI Agents SDK (`@openai/agents`'s `Agent` + `run` + `tool`). The
 * Agents SDK is KOTA's JavaScript surface for OpenAI's Responses API
 * agent loop. This adapter does not shell out to the Codex CLI or read
 * Codex CLI login state.
 *
 * The Agents SDK runs the multi-step tool loop internally when an
 * `Agent` is given a tool list and `run(agent, prompt, { stream: true,
 * maxTurns })` is invoked. KOTA exposes its tool registry to the SDK as
 * `FunctionTool[]` whose `execute` callbacks enforce
 * `disallowedTools`, `allowedTools`, and `canUseTool` before delegating
 * to `executeTool`. Streamed text deltas are picked off the
 * `output_text_delta` events and forwarded to the optional
 * `AgentHarnessWriter`.
 */

import type { Agent, run, tool } from "@openai/agents";

/**
 * Local structural alias matching the Agents SDK's `JsonObjectSchemaNonStrict`
 * shape. The SDK does not re-export the type at the top-level `@openai/agents`
 * surface, so we mirror the structure here to keep the adapter's tool
 * conversion type-checked without piercing into the SDK's internal types
 * subpath.
 */
type AgentsToolNonStrictParameters = {
  type: "object";
  properties: { [key: string]: { [key: string]: never } };
  required: string[];
  additionalProperties: true;
  description?: string;
};

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

/**
 * Lazy `@openai/agents` import. Mirrors the gemini and vercel adapters —
 * keeps module discovery cheap when an operator never selects this
 * harness, and avoids pulling the SDK's transitive runtime side effects
 * into module load.
 */
async function loadAgentsSdk(): Promise<typeof import("@openai/agents")> {
  return import("@openai/agents");
}

export const CODEX_AGENT_HARNESS_NAME = "codex";
export const CODEX_ASK_OWNER_TOOL_NAME = "ask_owner";

const DEFAULT_MAX_TURNS = 25;

type AgentsRunResult = Awaited<ReturnType<typeof run>>;

function rejectUnsupportedOptions(options: AgentHarnessRunOptions): void {
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    throw new Error(
      'The "codex" agent harness does not host MCP servers. Drop mcpServers ' +
        "or run the claude-agent-sdk harness which proxies them through the SDK.",
    );
  }
  if (options.autonomyMode === "supervised") {
    throw new Error(
      'The "codex" agent harness cannot route tool calls through the operator approval queue. ' +
        'Use autonomyMode "autonomous" or "passive", or run claude-agent-sdk.',
    );
  }
  if (options.persistSession === true) {
    throw new Error(
      'The "codex" agent harness does not persist sessions. ' +
        "Drop persistSession or run claude-agent-sdk for native session resumption.",
    );
  }
  if (options.harnessOverrides !== undefined) {
    throw new Error(
      'The "codex" agent harness does not accept per-step harnessOptions. ' +
        'Drop harnessOptions["codex"] or run an adapter that validates them.',
    );
  }
  if (options.enableFileCheckpointing === true) {
    throw new Error(
      'The "codex" agent harness does not support file checkpointing. ' +
        "Drop enableFileCheckpointing or run claude-agent-sdk.",
    );
  }
  if (options.thinkingEnabled === true) {
    throw new Error(
      'The "codex" agent harness does not host extended thinking through the ' +
        'thinkingEnabled toggle. Use the portable "effort" field — codex maps ' +
        "it to modelSettings.reasoning.effort — or run claude-agent-sdk.",
    );
  }
  if (options.onMessage !== undefined) {
    throw new Error(
      'The "codex" agent harness does not emit KotaAgentMessage frames. ' +
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
  if (includeAskOwner && allowSet) allowSet.add(CODEX_ASK_OWNER_TOOL_NAME);
  return all.filter((kotaTool) => {
    if (denySet.has(kotaTool.name)) return false;
    if (allowSet && !allowSet.has(kotaTool.name)) return false;
    return true;
  });
}

/**
 * Map KOTA's portable `AgentEffort` enum onto the Agents SDK's reasoning
 * effort literal. The SDK natively supports `low`, `medium`, `high`, and
 * `xhigh`; KOTA's `max` collapses to `xhigh` (the SDK has no "max"
 * literal).
 */
function mapEffortToReasoningEffort(
  effort: AgentEffort,
): "low" | "medium" | "high" | "xhigh" {
  if (effort === "low") return "low";
  if (effort === "medium") return "medium";
  if (effort === "high") return "high";
  return "xhigh";
}

type LoopFlags = {
  interrupted: boolean;
  interruptMessage: string;
};

function buildAgentTools(
  agentsSdk: typeof import("@openai/agents"),
  kotaTools: readonly KotaTool[],
  guardrails: {
    canUseTool: AgentCanUseTool | undefined;
    abortSignal: AbortSignal | undefined;
  },
  flags: LoopFlags,
  internalAbort: AbortController,
): ReturnType<typeof tool>[] {
  const result: ReturnType<typeof tool>[] = [];

  for (const kotaTool of kotaTools) {
    const definition = agentsSdk.tool({
      name: kotaTool.name,
      description: kotaTool.description,
      parameters: kotaTool.input_schema as unknown as AgentsToolNonStrictParameters,
      strict: false,
      execute: async (input, _runContext, details) => {
        if (!isPlainRecord(input)) {
          throw new Error(
            `codex adapter: tool "${kotaTool.name}" received non-object input ` +
              `(${input === null ? "null" : Array.isArray(input) ? "array" : typeof input}); ` +
              "the Agents SDK should validate against parameters before reaching execute.",
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
            toolUseId: details?.toolCall?.callId ?? kotaTool.name,
          });
          if (decision.behavior === "deny") {
            if (decision.interrupt === true) {
              flags.interrupted = true;
              flags.interruptMessage = decision.message;
              internalAbort.abort(
                new Error(`canUseTool interrupted the loop: ${decision.message}`),
              );
              return decision.message;
            }
            return decision.message;
          }
          if (
            decision.behavior === "allow" &&
            isPlainRecord(decision.updatedInput)
          ) {
            effectiveInput = decision.updatedInput;
          }
        }

        const executed = await executeTool(kotaTool.name, effectiveInput);
        return executed.content;
      },
    });
    result.push(definition);
  }
  return result;
}

export const codexAgentHarness: AgentHarness = {
  name: CODEX_AGENT_HARNESS_NAME,
  description:
    "Multi-turn tool-calling loop on the OpenAI Agents SDK (Agent + run + tool). Drives the OpenAI Codex/Responses agent runtime and honors canUseTool, allowedTools, disallowedTools.",
  supportsMultiTurn: true,
  supportedHookKinds: ["preRun", "postRun"] as const,
  askOwnerToolName: CODEX_ASK_OWNER_TOOL_NAME,
  emitsAgentMessageStream: false,
  async run(
    options: AgentHarnessRunOptions,
    writer?: AgentHarnessWriter,
  ): Promise<AgentHarnessResult> {
    if (options.askOwner) {
      return runWithAskOwnerSource(options.askOwner.source, () =>
        runCodexLoop(options, writer),
      );
    }
    return runCodexLoop(options, writer);
  },
};

async function runCodexLoop(
  options: AgentHarnessRunOptions,
  writer?: AgentHarnessWriter,
): Promise<AgentHarnessResult> {
  rejectUnsupportedOptions(options);
  if (!options.model) {
    throw new Error(
      'The "codex" agent harness requires an explicit model on the step or config.',
    );
  }
  if (options.abortController?.signal.aborted) {
    const reason = options.abortController.signal.reason;
    throw reason instanceof Error ? reason : new Error("Agent execution aborted");
  }

  const agentsSdk = await loadAgentsSdk();
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
  const tools = buildAgentTools(
    agentsSdk,
    kotaTools,
    {
      canUseTool: options.canUseTool,
      abortSignal: options.abortController?.signal,
    },
    flags,
    internalAbort,
  );

  const agent = new agentsSdk.Agent({
    name: "kota-codex-agent",
    instructions: options.systemPrompt ?? "",
    model: options.model,
    modelSettings: {
      reasoning: { effort: mapEffortToReasoningEffort(options.effort) },
    },
    tools,
  }) as Agent;

  const streamedChunks: string[] = [];
  let result: AgentsRunResult;
  try {
    result = await agentsSdk.run(agent, options.prompt, {
      stream: true,
      maxTurns,
      signal: internalAbort.signal,
    });
  } catch (err) {
    if (flags.interrupted) {
      return interruptedResult(flags, streamedChunks);
    }
    throw err;
  }

  try {
    for await (const event of result) {
      if (event.type === "raw_model_stream_event") {
        const data = event.data as { type?: string; delta?: string };
        if (data.type === "output_text_delta" && typeof data.delta === "string") {
          streamedChunks.push(data.delta);
          if (writer) writer.write(data.delta);
        }
      }
    }
    await result.completed;
  } catch (err) {
    if (flags.interrupted) {
      return interruptedResult(flags, streamedChunks);
    }
    throw err;
  }

  const usage = result.runContext.usage;
  const rawResponses = result.rawResponses;
  const turns = rawResponses.length;
  const finalText =
    typeof result.finalOutput === "string"
      ? result.finalOutput
      : streamedChunks.join("");
  const lastResponseId = result.lastResponseId;

  if (turns >= maxTurns && !result.finalOutput) {
    return {
      text:
        finalText || `codex harness reached maxTurns=${maxTurns} without ending.`,
      streamedText: streamedChunks.join(""),
      ...(lastResponseId !== undefined ? { sessionId: lastResponseId } : {}),
      turns,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      isError: true,
      subtype: "max_turns_reached",
    };
  }

  return {
    text: finalText,
    streamedText: streamedChunks.join(""),
    ...(lastResponseId !== undefined ? { sessionId: lastResponseId } : {}),
    turns,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
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
