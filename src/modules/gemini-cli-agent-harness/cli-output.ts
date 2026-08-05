import type {
  AgentHarnessWriter,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";

type GeminiCliError = {
  readonly type?: string;
  readonly message?: string;
  readonly code?: number;
};

type GeminiCliTokens = {
  readonly prompt?: number;
  readonly candidates?: number;
  readonly response?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
};

type GeminiCliModelStats = {
  readonly tokens?: GeminiCliTokens;
};

type GeminiCliStats = {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly models?: {
    readonly [modelName: string]: GeminiCliModelStats | undefined;
  };
};

type GeminiCliStreamEvent = {
  readonly type?: string;
  readonly session_id?: string;
  readonly sessionId?: string;
  readonly model?: string;
  readonly role?: string;
  readonly content?: string;
  readonly text?: string;
  readonly delta?: string;
  readonly message?: string;
  readonly response?: string | null;
  readonly severity?: string;
  readonly status?: string;
  readonly tool_name?: string;
  readonly tool_id?: string;
  readonly parameters?: Extract<KotaAgentMessage, { type: "tool_call" }>["input"];
  readonly output?: string;
  readonly stats?: GeminiCliStats;
  readonly error?: GeminiCliError | string | null;
};

type TokenCounts = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

export type CollectedGeminiOutput = {
  readonly streamedText: string;
  readonly responseText?: string;
  readonly sessionId?: string;
  readonly cliError?: string;
  readonly tokenCounts: TokenCounts;
  readonly sawStructuredOutput: boolean;
};

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseGeminiCliEvent(line: string): GeminiCliStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: GeminiCliStreamEvent;
  try {
    parsed = JSON.parse(trimmed) as GeminiCliStreamEvent;
  } catch {
    throw new Error(
      `Gemini CLI emitted non-JSON output in stream-json mode: ${trimmed}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Gemini CLI emitted non-object JSON event: ${trimmed}`);
  }
  return parsed;
}

function eventText(event: GeminiCliStreamEvent): string {
  if (isNonEmptyString(event.content)) return event.content;
  if (isNonEmptyString(event.text)) return event.text;
  if (isNonEmptyString(event.delta)) return event.delta;
  return "";
}

function errorMessage(error: GeminiCliError | string | null | undefined): string | undefined {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && isNonEmptyString(error.message)) {
    return error.message;
  }
  return undefined;
}

function extractTokenCounts(stats: GeminiCliStats | undefined): TokenCounts {
  if (
    typeof stats?.input_tokens === "number" ||
    typeof stats?.output_tokens === "number"
  ) {
    return {
      ...(typeof stats.input_tokens === "number"
        ? { inputTokens: stats.input_tokens }
        : {}),
      ...(typeof stats.output_tokens === "number"
        ? { outputTokens: stats.output_tokens }
        : {}),
    };
  }
  const models = stats?.models;
  if (!models) return {};
  let inputTokens = 0;
  let outputTokens = 0;
  let sawInput = false;
  let sawOutput = false;
  for (const modelName of Object.keys(models)) {
    const tokens = models[modelName]?.tokens;
    if (!tokens) continue;
    const input = tokens.input_tokens ?? tokens.prompt;
    if (typeof input === "number") {
      inputTokens += input;
      sawInput = true;
    }
    const output = tokens.output_tokens ?? tokens.candidates ?? tokens.response;
    if (typeof output === "number") {
      outputTokens += output;
      sawOutput = true;
    }
  }
  return {
    ...(sawInput ? { inputTokens } : {}),
    ...(sawOutput ? { outputTokens } : {}),
  };
}

async function emit(
  onMessage: ((message: KotaAgentMessage) => void | Promise<void>) | undefined,
  message: KotaAgentMessage,
): Promise<void> {
  await onMessage?.(message);
}

function withSession(
  message: KotaAgentMessage,
  sessionId: string | undefined,
): KotaAgentMessage {
  return sessionId === undefined ? message : { ...message, sessionId };
}

export function collectGeminiOutput(args: {
  lines: AsyncIterable<string>;
  writer: AgentHarnessWriter | undefined;
  onMessage: ((message: KotaAgentMessage) => void | Promise<void>) | undefined;
}): Promise<CollectedGeminiOutput> {
  return (async () => {
    const chunks: string[] = [];
    let responseText: string | undefined;
    let sessionId: string | undefined;
    let cliError: string | undefined;
    let tokenCounts: TokenCounts = {};
    let sawStructuredOutput = false;

    for await (const line of args.lines) {
      const event = parseGeminiCliEvent(line);
      if (!event) continue;
      sawStructuredOutput = true;
      if (isNonEmptyString(event.session_id)) sessionId = event.session_id;
      if (isNonEmptyString(event.sessionId)) sessionId = event.sessionId;

      if (event.type === "init") {
        await emit(
          args.onMessage,
          withSession(
            {
              type: "status",
              category: "gemini.initialized",
              ...(isNonEmptyString(event.model)
                ? { description: event.model }
                : {}),
            },
            sessionId,
          ),
        );
      } else if (event.type === "message" && event.role !== "user") {
        const text = eventText(event);
        if (text) {
          chunks.push(text);
          args.writer?.write(text);
          await emit(
            args.onMessage,
            withSession({ type: "text", text }, sessionId),
          );
        }
      } else if (
        event.type === "tool_use" &&
        isNonEmptyString(event.tool_id) &&
        isNonEmptyString(event.tool_name) &&
        event.parameters !== undefined
      ) {
        await emit(
          args.onMessage,
          withSession(
            {
              type: "tool_call",
              toolUseId: event.tool_id,
              toolName: event.tool_name,
              input: event.parameters,
            },
            sessionId,
          ),
        );
      } else if (event.type === "tool_result" && isNonEmptyString(event.tool_id)) {
        const toolError = errorMessage(event.error);
        await emit(
          args.onMessage,
          withSession(
            {
              type: "tool_result",
              toolUseId: event.tool_id,
              isError: event.status === "error" || toolError !== undefined,
              content: event.output ?? toolError ?? "",
            },
            sessionId,
          ),
        );
      } else if (event.type === "error") {
        const detail = errorMessage(event.error) ??
          event.message ?? "Gemini CLI reported an error";
        if (event.severity !== "warning") cliError = detail;
        await emit(
          args.onMessage,
          withSession(
            {
              type: "status",
              category: "gemini.error",
              ...(event.severity !== undefined
                ? { description: event.severity }
                : {}),
              text: detail,
            },
            sessionId,
          ),
        );
      } else if (event.type === "result" || event.type === undefined) {
        if (typeof event.response === "string") responseText = event.response;
        const parsedError = errorMessage(event.error);
        if (parsedError) cliError = parsedError;
        if (event.status === "error" && cliError === undefined) {
          cliError = "Gemini CLI reported status error";
        }
        const parsedTokens = extractTokenCounts(event.stats);
        tokenCounts = {
          ...(parsedTokens.inputTokens !== undefined
            ? { inputTokens: parsedTokens.inputTokens }
            : tokenCounts.inputTokens !== undefined
              ? { inputTokens: tokenCounts.inputTokens }
              : {}),
          ...(parsedTokens.outputTokens !== undefined
            ? { outputTokens: parsedTokens.outputTokens }
            : tokenCounts.outputTokens !== undefined
              ? { outputTokens: tokenCounts.outputTokens }
              : {}),
        };
        if (responseText && chunks.length === 0) {
          chunks.push(responseText);
          args.writer?.write(responseText);
          await emit(
            args.onMessage,
            withSession({ type: "text", text: responseText }, sessionId),
          );
        }
        await emit(
          args.onMessage,
          withSession(
            {
              type: "result",
              ...(responseText !== undefined ? { text: responseText } : {}),
              ...(event.status !== undefined ? { subtype: event.status } : {}),
              isError: cliError !== undefined,
              numTurns: 1,
              ...(tokenCounts.inputTokens !== undefined
                ? { inputTokens: tokenCounts.inputTokens }
                : {}),
              ...(tokenCounts.outputTokens !== undefined
                ? { outputTokens: tokenCounts.outputTokens }
                : {}),
            },
            sessionId,
          ),
        );
      } else {
        await emit(
          args.onMessage,
          withSession(
            {
              type: "raw",
              adapter: "gemini-cli",
              payload: { ...event },
            },
            sessionId,
          ),
        );
      }
    }

    return {
      streamedText: chunks.join(""),
      ...(responseText !== undefined ? { responseText } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(cliError !== undefined ? { cliError } : {}),
      tokenCounts,
      sawStructuredOutput,
    };
  })();
}

export function emptyCollectedGeminiOutput(): CollectedGeminiOutput {
  return {
    streamedText: "",
    tokenCounts: {},
    sawStructuredOutput: false,
  };
}
