import type {
  WorkflowAgentBackoffKind,
  WorkflowRetryConfig,
} from "../types.js";

/**
 * Runtime default retry applied to every agent step unless the step
 * declares its own `retry:` override. Sized to absorb a short provider
 * hiccup without delaying legitimate hard failures — the SDK already
 * retries transient errors internally, so this is a narrow last line.
 */
export const DEFAULT_AGENT_STEP_RETRY: WorkflowRetryConfig = {
  maxAttempts: 2,
  initialDelayMs: 5000,
  backoffFactor: 2,
};

export class AgentStepRuntimeError extends Error {
  constructor(
    message: string,
    readonly kind: WorkflowAgentBackoffKind,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AgentStepRuntimeError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WithRetryOptions = {
  log?: (message: string) => void;
  abortSignal?: AbortSignal;
  /**
   * Predicate deciding whether a thrown error should consume a retry
   * attempt. When omitted, every non-abort error is retried (the default
   * permissive policy used by tool steps). Agent steps pass a stricter
   * predicate so only classified-retryable failures consume the budget.
   */
  shouldRetry?: (error: unknown) => boolean;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  retry: WorkflowRetryConfig,
  logOrOptions?: ((message: string) => void) | WithRetryOptions,
  abortSignalLegacy?: AbortSignal,
): Promise<T> {
  const options: WithRetryOptions =
    typeof logOrOptions === "function"
      ? { log: logOrOptions, abortSignal: abortSignalLegacy }
      : (logOrOptions ?? {});
  const { log, abortSignal, shouldRetry } = options;

  let lastError: unknown;
  let delayMs = retry.initialDelayMs;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (
        abortSignal?.aborted ||
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof AgentStepRuntimeError && !error.retryable)
      ) {
        throw error;
      }
      if (shouldRetry && !shouldRetry(error)) throw error;
      lastError = error;
      if (attempt < retry.maxAttempts) {
        log?.(
          `Attempt ${attempt}/${retry.maxAttempts} failed; retrying in ${delayMs}ms. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delayMs);
        delayMs = Math.round(delayMs * retry.backoffFactor);
      }
    }
  }
  throw lastError;
}

/**
 * Structured input to the classifier. Callers should populate whichever
 * fields the error surface exposes; the classifier keys on the structured
 * fields first and only falls back to `message` for the SDK-specific
 * "API Error: <status>" marker it encodes into its error text.
 */
export type AgentFailureContext = {
  message: string;
  /** SDK result subtype, e.g. "error_max_turns", "error_during_execution". */
  subtype?: string;
  /** HTTP status code when the underlying error carries one. */
  status?: number;
  /** Node.js system error code (errno), e.g. "ECONNRESET", "ENOTFOUND". */
  code?: string;
  /** Error name, e.g. "AbortError". */
  errorName?: string;
};

export type AgentFailureClassification = {
  kind: WorkflowAgentBackoffKind;
  retryable: boolean;
};

const PROVIDER_HTTP_STATUSES = new Set([408, 500, 502, 503, 504, 529]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
]);

function classifyHttpStatus(
  status: number,
): AgentFailureClassification | null {
  if (status === 429) return { kind: "rate_limit", retryable: false };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (PROVIDER_HTTP_STATUSES.has(status) || (status >= 500 && status < 600)) {
    return { kind: "provider", retryable: true };
  }
  return null;
}

function parseApiErrorStatus(text: string): number | undefined {
  const match = /API Error:\s*(\d{3})\b/i.exec(text);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * Classify an agent runtime failure against structured error signals.
 *
 * Returns a classification when the failure is recognisably a provider,
 * rate-limit, or auth problem. Returns null for anything else — and the
 * caller treats that as an unclassified hard failure: the step fails, the
 * run aborts, and no agent-dispatch backoff is applied. Silent coercion of
 * unknown errors into retryable provider failures is intentionally not
 * done here.
 */
export function classifyAgentRuntimeFailure(
  input: AgentFailureContext,
): AgentFailureClassification | null {
  if (input.errorName === "AbortError") return null;

  if (input.subtype?.startsWith("error_")) {
    if (
      input.subtype === "error_max_turns" ||
      input.subtype === "error_max_tokens"
    ) {
      // Agent ran itself out of turns/tokens. Not a provider-side problem;
      // failing hard is the correct response.
      return null;
    }
    // Other "error_*" subtypes are generic wrappers (e.g.
    // "error_during_execution"). Fall through to the other signals.
  }

  if (typeof input.status === "number") {
    const byStatus = classifyHttpStatus(input.status);
    if (byStatus) return byStatus;
  }

  if (input.code && NETWORK_ERROR_CODES.has(input.code)) {
    return { kind: "provider", retryable: true };
  }

  const apiStatus = parseApiErrorStatus(input.message);
  if (apiStatus !== undefined) {
    const byText = classifyHttpStatus(apiStatus);
    if (byText) return byText;
  }

  // SDK wraps CLI-side rate-limit / auth responses into its error text
  // without a structured code, so a narrow text check is the only signal.
  if (/\b(?:rate limit|quota)\b/i.test(input.message)) {
    return { kind: "rate_limit", retryable: false };
  }
  if (/(?:you've|you have) hit your limit/i.test(input.message)) {
    return { kind: "rate_limit", retryable: false };
  }
  if (
    /\b(?:not logged in|please run \/login|unauthorized|authentication)\b/i.test(
      input.message,
    )
  ) {
    return { kind: "auth", retryable: false };
  }

  return null;
}
