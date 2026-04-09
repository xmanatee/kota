import type { ToolMiddlewareFn } from "../../tool-middleware.js";
import type { ToolResult } from "../../tools/index.js";

/** Max timeout we'll auto-retry a shell command with (5 minutes). */
const SHELL_MAX_RETRY_TIMEOUT = 300_000;

/** Transient network-level error patterns. */
const TRANSIENT_NETWORK =
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|socket hang up|fetch failed/i;

/** Transient HTTP status codes (in tool error output like "HTTP 502 Bad Gateway"). */
const TRANSIENT_HTTP = /\bHTTP\s+(429|500|502|503|504)\b/;

/** Shell timeout patterns (covers both "timed out" and "timeout after"). */
const SHELL_TIMEOUT = /timed?\s*out|timeout/i;

type RetryPolicy = {
  shouldRetry: (error: string, input: Record<string, unknown>) => boolean;
  adjustInput?: (input: Record<string, unknown>) => Record<string, unknown>;
  delayMs?: number;
};

export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  shell: {
    shouldRetry(error, input) {
      if (!SHELL_TIMEOUT.test(error)) return false;
      const current = (input.timeout_ms as number) || 120_000;
      return current * 2 <= SHELL_MAX_RETRY_TIMEOUT;
    },
    adjustInput(input) {
      const current = (input.timeout_ms as number) || 120_000;
      return { ...input, timeout_ms: current * 2 };
    },
  },

  web_fetch: {
    shouldRetry(error) {
      return TRANSIENT_NETWORK.test(error) || TRANSIENT_HTTP.test(error);
    },
    delayMs: 1500,
  },

  web_search: {
    shouldRetry(error) {
      return TRANSIENT_NETWORK.test(error) || TRANSIENT_HTTP.test(error);
    },
    delayMs: 1500,
  },

  http_request: {
    shouldRetry(error) {
      return TRANSIENT_NETWORK.test(error) || TRANSIENT_HTTP.test(error);
    },
    delayMs: 1500,
  },
};

// ─── Middleware-based retry ──────────────────────────────────────────

export type RetryStats = {
  totalRetries: number;
  successAfterRetry: number;
  exhausted: number;
};

const _stats: RetryStats = { totalRetries: 0, successAfterRetry: 0, exhausted: 0 };

export function getRetryStats(): RetryStats {
  return { ..._stats };
}

export function resetRetryStats(): void {
  _stats.totalRetries = 0;
  _stats.successAfterRetry = 0;
  _stats.exhausted = 0;
}

/**
 * Create a middleware that auto-retries transient tool failures.
 *
 * Uses the same RETRY_POLICIES as maybeRetry — same tools, same error
 * classification, same input adjustment (e.g. shell timeout doubling).
 * The middleware mutates call.input when adjustInput is defined, so
 * baseFn must read from call.input (not a captured variable).
 */
export function createRetryMiddleware(
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): ToolMiddlewareFn {
  return async (call, next) => {
    const result = await next();
    if (!result.is_error) return result;

    const policy = RETRY_POLICIES[call.name];
    if (!policy) return result;
    if (!policy.shouldRetry(result.content, call.input)) return result;

    // Adjust input if the policy supports it (e.g. shell timeout doubling)
    if (policy.adjustInput) {
      call.input = policy.adjustInput(call.input);
    }

    if (policy.delayMs) {
      await sleepFn(policy.delayMs);
    }

    let reason = "transient error";
    if (call.name === "shell" && call.input.timeout_ms) {
      reason = `timeout → ${Math.round((call.input.timeout_ms as number) / 1000)}s`;
    }

    console.error(`[kota] Auto-retrying ${call.name} (${reason})...`);
    _stats.totalRetries++;

    const retryResult = await next();

    if (!retryResult.is_error) {
      _stats.successAfterRetry++;
      return {
        content: `${retryResult.content}\n\n(Succeeded on auto-retry: ${reason})`,
      };
    }

    _stats.exhausted++;
    const originalSnippet = result.content.slice(0, 200);
    return {
      content: `${retryResult.content}\n\n(Auto-retry also failed. Original error: ${originalSnippet})`,
      is_error: true,
    };
  };
}

/**
 * Attempt one auto-retry for a failed tool call when a matching retry
 * policy exists. Returns the retry result, or null if no retry applies.
 *
 * @deprecated Use createRetryMiddleware() instead. Kept for backward
 * compatibility; prefer routing tool execution through the middleware chain.
 */
export async function maybeRetry(
  toolName: string,
  input: Record<string, unknown>,
  failedResult: ToolResult,
  runner: (name: string, input: Record<string, unknown>) => Promise<ToolResult>,
): Promise<ToolResult | null> {
  const policy = RETRY_POLICIES[toolName];
  if (!policy) return null;
  if (!policy.shouldRetry(failedResult.content, input)) return null;

  const adjustedInput = policy.adjustInput ? policy.adjustInput(input) : input;

  let reason = "transient error";
  if (toolName === "shell" && adjustedInput.timeout_ms) {
    reason = `timeout → ${Math.round((adjustedInput.timeout_ms as number) / 1000)}s`;
  }

  if (policy.delayMs) {
    await new Promise((r) => setTimeout(r, policy.delayMs));
  }

  console.error(`[kota] Auto-retrying ${toolName} (${reason})...`);

  const retryResult = await runner(toolName, adjustedInput);

  if (retryResult.is_error) {
    const originalSnippet = failedResult.content.slice(0, 200);
    return {
      content: `${retryResult.content}\n\n(Auto-retry also failed. Original error: ${originalSnippet})`,
      is_error: true,
    };
  }

  return {
    content: `${retryResult.content}\n\n(Succeeded on auto-retry: ${reason})`,
  };
}
