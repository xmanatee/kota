/**
 * Shared HTTP POST helper with exponential-backoff retry for notification extensions.
 *
 * Used by the webhook and Slack extensions. Retries on non-2xx responses and
 * network errors; logs a warning after all attempts are exhausted.
 *
 * Retries are async (setTimeout-based) and do not block the bus event handler.
 */

export type RetryOptions = {
  /** Number of retry attempts after the initial try. Default: 3. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  baseDelayMs?: number;
};

/**
 * POST `body` to `url` and retry with exponential backoff on failure.
 * Resolves on the first successful (2xx) response. After all retries are
 * exhausted logs a warning and resolves (never rejects).
 */
export async function postWithRetry(
  url: string,
  body: string,
  log: { warn: (msg: string) => void },
  options: RetryOptions = {},
): Promise<void> {
  const maxRetries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  log.warn(`POST to ${url} failed after ${maxRetries + 1} attempt(s): ${lastError}`);
}
