import type { AgentHarnessWriter } from "#core/agent-harness/index.js";

type GeminiCliError = {
  readonly type?: string;
  readonly message?: string;
  readonly code?: number;
};

type GeminiCliTokens = {
  readonly prompt?: number;
  readonly candidates?: number;
  readonly response?: number;
};

type GeminiCliModelStats = {
  readonly tokens?: GeminiCliTokens;
};

type GeminiCliStats = {
  readonly models?: {
    readonly [modelName: string]: GeminiCliModelStats | undefined;
  };
};

type GeminiCliStreamEvent = {
  readonly type?: string;
  readonly session_id?: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly content?: string;
  readonly text?: string;
  readonly delta?: string;
  readonly message?: string;
  readonly response?: string | null;
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
  const models = stats?.models;
  if (!models) return {};
  let inputTokens = 0;
  let outputTokens = 0;
  let sawInput = false;
  let sawOutput = false;
  for (const modelName of Object.keys(models)) {
    const tokens = models[modelName]?.tokens;
    if (!tokens) continue;
    if (typeof tokens.prompt === "number") {
      inputTokens += tokens.prompt;
      sawInput = true;
    }
    const output = tokens.candidates ?? tokens.response;
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

export function collectGeminiOutput(args: {
  lines: AsyncIterable<string>;
  writer: AgentHarnessWriter | undefined;
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

      if (event.type === "message" && event.role !== "user") {
        const text = eventText(event);
        if (text) {
          chunks.push(text);
          args.writer?.write(text);
        }
      }

      if (event.type === "error") {
        cliError = errorMessage(event.error) ?? event.message ?? "Gemini CLI reported an error";
      }

      if (event.type === "result" || event.type === undefined) {
        if (typeof event.response === "string") responseText = event.response;
        const parsedError = errorMessage(event.error);
        if (parsedError) cliError = parsedError;
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
      }
    }

    if (responseText && chunks.length === 0) {
      chunks.push(responseText);
      args.writer?.write(responseText);
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
