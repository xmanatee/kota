import type { OutboundHttpMethod, OutboundHttpRetryDisposition } from "#core/outbound-http/types.js";

const IDEMPOTENT_METHODS: ReadonlySet<OutboundHttpMethod> = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function supportsRetry(method: OutboundHttpMethod, idempotencyKey?: string): boolean {
  return IDEMPOTENT_METHODS.has(method) || Boolean(idempotencyKey);
}

export function responseRetryDisposition(
  method: OutboundHttpMethod,
  idempotencyKey: string | undefined,
  status: number,
  headers: Headers,
  nowMs: number,
): OutboundHttpRetryDisposition {
  if (!supportsRetry(method, idempotencyKey)) {
    return { eligible: false, reason: "method-not-idempotent" };
  }
  if (!TRANSIENT_STATUSES.has(status)) {
    return { eligible: false, reason: "response-not-transient" };
  }
  return {
    eligible: true,
    reason: "transient-response",
    retryAfterMs: parseRetryAfter(headers.get("retry-after"), nowMs),
  };
}

export function failureRetryDisposition(
  method: OutboundHttpMethod,
  idempotencyKey: string | undefined,
  kind: "network" | "timeout" | "policy" | "aborted",
): OutboundHttpRetryDisposition {
  if (kind === "policy") return { eligible: false, reason: "policy-rejection" };
  if (kind === "aborted") return { eligible: false, reason: "caller-aborted" };
  if (!supportsRetry(method, idempotencyKey)) {
    return { eligible: false, reason: "method-not-idempotent" };
  }
  return {
    eligible: true,
    reason: kind === "timeout" ? "timeout" : "network-failure",
    retryAfterMs: null,
  };
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  if (/^\d+$/.test(value.trim())) return Number.parseInt(value, 10) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - nowMs);
}
