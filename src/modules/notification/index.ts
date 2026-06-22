import type { KotaModule } from "#core/modules/module-types.js";

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  logUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function postWithRetry(
  url: string,
  body: string,
  log: { warn: (msg: string) => void },
  options: RetryOptions = {},
): Promise<void> {
  const maxRetries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logUrl = options.logUrl ?? url;

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body,
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  log.warn(`POST to ${logUrl} failed after ${maxRetries + 1} attempt(s): ${lastError}`);
}

const notificationModule: KotaModule = {
  name: "notification",
  version: "1.0.0",
  description: "Shared notification delivery primitives",
};

export default notificationModule;
