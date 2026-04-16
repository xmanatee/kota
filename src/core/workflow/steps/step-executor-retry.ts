import type {
  WorkflowAgentBackoffKind,
  WorkflowRetryConfig,
} from "../types.js";

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

export async function withRetry<T>(
  fn: () => Promise<T>,
  retry: WorkflowRetryConfig,
  log?: (message: string) => void,
  abortSignal?: AbortSignal,
): Promise<T> {
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

export function classifyAgentRuntimeFailure(
  text: string,
): { kind: WorkflowAgentBackoffKind; retryable: boolean } | null {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("you've hit your limit") ||
    normalized.includes("hit your limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota")
  ) {
    return { kind: "rate_limit", retryable: false };
  }

  if (
    normalized.includes("not logged in") ||
    normalized.includes("please run /login") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication")
  ) {
    return { kind: "auth", retryable: false };
  }

  if (
    normalized.includes("network error") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound") ||
    normalized.includes("spawn ") ||
    normalized.includes("broken pipe") ||
    normalized.includes("connection reset") ||
    normalized.includes("internal server error") ||
    normalized.includes("service unavailable") ||
    normalized.includes("overloaded") ||
    /api error: 5\d\d/.test(normalized)
  ) {
    return { kind: "provider", retryable: true };
  }

  return null;
}
