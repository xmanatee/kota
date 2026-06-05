import type { WorkflowAgentBackoffKind, WorkflowRetryConfig } from "../trigger-types.js";

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

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  throwIfAborted(abortSignal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      abortSignal.removeEventListener("abort", onAbort);
      reject(abortError(abortSignal));
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
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
    throwIfAborted(abortSignal);
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
        await sleep(delayMs, abortSignal);
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

  if (input.subtype === "harness_readiness") {
    return { kind: "auth", retryable: false };
  }

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
  if (/(?:you've|you have) hit your (?:usage )?limit/i.test(input.message)) {
    return { kind: "rate_limit", retryable: false };
  }
  if (
    /\b(?:not logged in|please run \/login|unauthorized|authentication)\b/i.test(
      input.message,
    )
  ) {
    return { kind: "auth", retryable: false };
  }
  if (
    /organization has disabled Claude subscription access for Claude Code/i.test(
      input.message,
    ) ||
    /Use an Anthropic API key instead/i.test(input.message)
  ) {
    return { kind: "auth", retryable: false };
  }

  // Anthropic SDK emits this exact prefix when the streaming response stalls
  // server-side after the SDK has exhausted its internal retry budget. It is
  // distinct from generic "timeout" text because it carries the literal
  // "API Error: Stream idle timeout" marker. Classifying it as provider lets
  // AgentBackoffManager apply a 5+ min dispatch delay so the next agent run
  // does not collide with the same upstream stall.
  if (/api error:\s*stream idle timeout/i.test(input.message)) {
    return { kind: "provider", retryable: true };
  }
  if (/api error:\s*unable to connect to api\s*\(ConnectionRefused\)/i.test(input.message)) {
    return { kind: "provider", retryable: true };
  }
  if (
    /stream disconnected before completion:\s*idle timeout sending websocket request/i.test(
      input.message,
    )
  ) {
    return { kind: "provider", retryable: true };
  }
  if (
    /stream disconnected before completion:\s*idle timeout waiting for websocket/i.test(
      input.message,
    )
  ) {
    return { kind: "provider", retryable: true };
  }
  if (
    /stream disconnected before completion:\s*failed to lookup address information:\s*nodename nor servname provided, or not known/i.test(
      input.message,
    )
  ) {
    return { kind: "provider", retryable: true };
  }
  if (
    /error running remote compact task:\s*stream disconnected before completion:\s*error sending request for url \(https:\/\/chatgpt\.com\/backend-api\/codex\/responses\/compact\)/i.test(
      input.message,
    )
  ) {
    return { kind: "provider", retryable: true };
  }
  if (
    /stream disconnected before completion:\s*error sending request for url \(https:\/\/chatgpt\.com\/backend-api\/codex\/responses\)/i.test(
      input.message,
    )
  ) {
    return { kind: "provider", retryable: true };
  }
  // The Codex CLI sometimes exits without stderr or a JSON error after the
  // remote response stream dies. With no agent output to inspect, this is an
  // adapter/provider signal rather than a workflow-quality failure.
  if (
    input.subtype === "codex_cli_error" &&
    /\bCodex CLI exited with code 1\b/.test(input.message)
  ) {
    return { kind: "provider", retryable: true };
  }

  return null;
}

/**
 * Classify an unknown thrown error against the structured-signal classifier.
 * Pulls `status`, system `code`, error name, and message off the error before
 * delegating to {@link classifyAgentRuntimeFailure}. Returns null for
 * unclassified errors (the caller surfaces them as hard failures).
 */
export function classifyThrownAgentError(
  error: unknown,
): AgentFailureClassification | null {
  const detail = error instanceof Error ? error.message : String(error);
  const sysError = error as NodeJS.ErrnoException;
  const errorWithStatus = error as { status?: number };
  return classifyAgentRuntimeFailure({
    message: detail,
    status:
      typeof errorWithStatus.status === "number"
        ? errorWithStatus.status
        : undefined,
    code: typeof sysError.code === "string" ? sysError.code : undefined,
    errorName: error instanceof Error ? error.name : undefined,
  });
}
