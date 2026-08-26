import type { KotaModule } from "#core/modules/module-types.js";
import {
  OUTBOUND_HTTP_PROFILES,
  OutboundHttpError,
  type OutboundHttpTransport,
  outboundHttp,
} from "#core/outbound-http/index.js";

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
  logUrl?: string;
  http?: Pick<OutboundHttpTransport, "request">;
};

export async function postWithRetry(
  url: string,
  body: string,
  log: { warn: (msg: string) => void },
  options: RetryOptions = {},
): Promise<void> {
  const maxRetries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const http = options.http ?? outboundHttp;
  const logUrl = options.logUrl ?? url;

  let lastError = "";
  let attempts = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    attempts += 1;
    try {
      const { response: res } = await http.request({
        profile: OUTBOUND_HTTP_PROFILES.explicitCallback([url]),
        operation: "notification.webhook.post",
        url,
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body,
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = redactUrlInFailureMessage(message, url, logUrl);
      if (err instanceof OutboundHttpError && !err.failure.retry.eligible) break;
    }
  }
  log.warn(`POST to ${logUrl} failed after ${attempts} attempt(s): ${lastError}`);
}

function redactUrlInFailureMessage(message: string, rawUrl: string, logUrl: string): string {
  if (rawUrl === logUrl) return message;
  for (const sensitiveUrl of sensitiveUrlVariants(rawUrl)) {
    message = message.split(sensitiveUrl).join(logUrl);
  }
  return message;
}

function sensitiveUrlVariants(rawUrl: string): string[] {
  const variants = new Set([rawUrl]);
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    variants.add(parsed.toString());
  } catch {
    return [...variants];
  }
  return [...variants];
}

const notificationModule: KotaModule = {
  name: "notification",
  version: "1.0.0",
  description: "Shared notification delivery primitives",
};

export default notificationModule;
