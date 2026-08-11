import type {
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import { buildKotaAgentCommandTrace } from "#core/agent-harness/index.js";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";

type AntigravityUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type AntigravityToolInfo = {
  name?: string;
  parameters?: KotaJsonObject;
  error?: { message?: string };
};

type AntigravityStepUpdate = {
  conversation_id?: string;
  step_index?: number;
  state?: string;
  step_type?: string;
  text_delta?: string;
  tool_name?: string;
  tool_info?: AntigravityToolInfo;
};

type AntigravityResult = {
  conversation_id?: string;
  status?: string;
  response?: string;
  structured_output?: KotaJsonValue;
  error?: string;
  num_turns?: number;
  usage?: AntigravityUsage;
};

type AntigravityEvent = {
  event?: string;
  conversation_id?: string;
  step_update?: AntigravityStepUpdate;
  result?: AntigravityResult;
};

const TRACE_COMMAND_PARAMETER_KEYS = new Set([
  "cmd",
  "command",
  "command_line",
  "commandline",
]);

export type CollectedAntigravityOutput = {
  streamedText: string;
  responseText?: string;
  structuredOutput?: KotaJsonValue;
  hasTerminalResult: boolean;
  sessionId?: string;
  cliError?: string;
  lastToolFailure?: {
    toolName?: string;
    detail: string;
  };
  turns: number;
  inputTokens?: number;
  outputTokens?: number;
};

function parseEvent(line: string): AntigravityEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `Antigravity CLI emitted non-JSON output in stream-json mode: ${trimmed}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Antigravity CLI emitted non-object JSON event: ${trimmed}`);
  }
  return parsed as AntigravityEvent;
}

async function emit(
  onMessage: ((message: KotaAgentMessage) => void | Promise<void>) | undefined,
  message: KotaAgentMessage,
): Promise<void> {
  await onMessage?.(message);
}

function traceableCommand(
  parameters: KotaJsonObject | undefined,
): string | undefined {
  if (parameters === undefined) return undefined;
  for (const [key, value] of Object.entries(parameters)) {
    if (
      TRACE_COMMAND_PARAMETER_KEYS.has(key.toLowerCase()) &&
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      return value;
    }
  }
  return undefined;
}

export function collectAntigravityOutput(args: {
  lines: AsyncIterable<string>;
  writer: AgentHarnessWriter | undefined;
  onMessage: ((message: KotaAgentMessage) => void | Promise<void>) | undefined;
}): Promise<CollectedAntigravityOutput> {
  return (async () => {
    const chunks: string[] = [];
    let responseText: string | undefined;
    let structuredOutput: KotaJsonValue | undefined;
    let hasTerminalResult = false;
    let sessionId: string | undefined;
    let cliError: string | undefined;
    let lastToolFailure: CollectedAntigravityOutput["lastToolFailure"];
    let turns = 0;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    for await (const line of args.lines) {
      const event = parseEvent(line);
      if (event === undefined) continue;
      if (typeof event.conversation_id === "string") {
        sessionId = event.conversation_id;
      }

      if (event.event === "init") {
        await emit(args.onMessage, {
          type: "status",
          category: "initialized",
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        continue;
      }

      const update = event.step_update;
      if (event.event === "step_update" && update !== undefined) {
        if (typeof update.conversation_id === "string") {
          sessionId = update.conversation_id;
        }
        if (
          update.step_type === "agent_response" &&
          typeof update.text_delta === "string" &&
          update.text_delta.length > 0
        ) {
          chunks.push(update.text_delta);
          args.writer?.write(update.text_delta);
          await emit(args.onMessage, {
            type: "text",
            text: update.text_delta,
            ...(sessionId !== undefined ? { sessionId } : {}),
          });
          continue;
        }
        const toolName = update.tool_name ?? update.tool_info?.name;
        const toolError = update.tool_info?.error?.message;
        const command = traceableCommand(
          update.tool_info?.parameters,
        );
        if (toolError !== undefined || update.state?.toUpperCase() === "ERROR") {
          lastToolFailure = {
            ...(toolName !== undefined ? { toolName } : {}),
            detail: toolError ??
              (toolName === undefined
                ? "Antigravity CLI tool failed"
                : `Antigravity CLI tool "${toolName}" failed`),
          };
        }
        await emit(args.onMessage, {
          type: "status",
          category: update.step_type ?? "step",
          ...(update.state !== undefined ? { description: update.state } : {}),
          ...(toolName !== undefined ? { toolName } : {}),
          ...(command !== undefined
            ? { commandTrace: buildKotaAgentCommandTrace(command) }
            : {}),
          ...(update.tool_info?.error?.message !== undefined
            ? { text: update.tool_info.error.message }
            : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        continue;
      }

      const result = event.result;
      if (event.event === "result" && result !== undefined) {
        if (typeof result.conversation_id === "string") {
          sessionId = result.conversation_id;
        }
        responseText = result.response;
        structuredOutput = result.structured_output;
        hasTerminalResult = true;
        turns = result.num_turns ?? 0;
        inputTokens = result.usage?.input_tokens;
        outputTokens = result.usage?.output_tokens;
        if (result.status !== "SUCCESS") {
          cliError = result.error ??
            `Antigravity CLI reported status ${result.status ?? "UNKNOWN"}`;
        }
        await emit(args.onMessage, {
          type: "result",
          ...(result.response !== undefined ? { text: result.response } : {}),
          ...(result.status !== undefined ? { subtype: result.status } : {}),
          isError: result.status !== "SUCCESS",
          ...(result.num_turns !== undefined
            ? { numTurns: result.num_turns }
            : {}),
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        continue;
      }

      await emit(args.onMessage, {
        type: "raw",
        adapter: "antigravity-cli",
        payload: { ...event },
        ...(sessionId !== undefined ? { sessionId } : {}),
      });
    }

    if (responseText && chunks.length === 0) {
      chunks.push(responseText);
      args.writer?.write(responseText);
    }

    return {
      streamedText: chunks.join(""),
      ...(responseText !== undefined ? { responseText } : {}),
      ...(structuredOutput !== undefined ? { structuredOutput } : {}),
      hasTerminalResult,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(cliError !== undefined ? { cliError } : {}),
      ...(lastToolFailure !== undefined ? { lastToolFailure } : {}),
      turns,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
    };
  })();
}

export function emptyCollectedAntigravityOutput(): CollectedAntigravityOutput {
  return {
    streamedText: "",
    hasTerminalResult: false,
    turns: 0,
  };
}
