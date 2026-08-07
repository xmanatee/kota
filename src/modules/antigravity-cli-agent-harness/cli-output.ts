import type {
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";

type AntigravityUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type AntigravityToolInfo = {
  name?: string;
  parameters?: Record<string, unknown>;
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
  structured_output?: unknown;
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

export type CollectedAntigravityOutput = {
  streamedText: string;
  responseText?: string;
  structuredOutput?: unknown;
  hasTerminalResult: boolean;
  sessionId?: string;
  cliError?: string;
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

export function collectAntigravityOutput(args: {
  lines: AsyncIterable<string>;
  writer: AgentHarnessWriter | undefined;
  onMessage: ((message: KotaAgentMessage) => void | Promise<void>) | undefined;
}): Promise<CollectedAntigravityOutput> {
  return (async () => {
    const chunks: string[] = [];
    let responseText: string | undefined;
    let structuredOutput: unknown;
    let hasTerminalResult = false;
    let sessionId: string | undefined;
    let cliError: string | undefined;
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
        await emit(args.onMessage, {
          type: "status",
          category: update.step_type ?? "step",
          ...(update.state !== undefined ? { description: update.state } : {}),
          ...(toolName !== undefined ? { toolName } : {}),
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
        payload: event as unknown as Record<string, unknown>,
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
