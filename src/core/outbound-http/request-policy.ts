import { outboundHttpPolicy } from "#core/outbound-http/profiles.js";
import type { OutboundHttpMethod, OutboundHttpRequest } from "#core/outbound-http/types.js";

const CROSS_ORIGIN_SAFE_HEADERS = new Set(["accept", "accept-language", "user-agent"]);

export type PreparedOutboundHttpRequest = {
  readonly url: URL;
  readonly method: OutboundHttpMethod;
  readonly headers: Headers;
  readonly timeoutMs: number;
  readonly responseBytes: number;
};

export function prepareOutboundHttpRequest(request: OutboundHttpRequest, method: OutboundHttpMethod): PreparedOutboundHttpRequest {
  if (!request.operation.trim()) throw new TypeError("outbound HTTP operation must be non-empty");
  const url = new URL(request.url);
  const policy = outboundHttpPolicy(request.profile.name);
  const timeoutMs = resolveLimit(request.limits?.timeoutMs, policy.timeoutMs.default, policy.timeoutMs.maximum, "timeoutMs");
  const responseBytes = resolveLimit(
    request.limits?.responseBytes,
    policy.responseBytes.default,
    policy.responseBytes.maximum,
    "responseBytes",
  );
  if ((method === "GET" || method === "HEAD") && request.body != null) {
    throw new TypeError(`${method} requests cannot contain a body`);
  }
  const headers = new Headers(request.headers);
  if (request.idempotencyKey !== undefined) {
    if (!request.idempotencyKey.trim()) throw new TypeError("idempotencyKey must be non-empty");
    const existing = headers.get("idempotency-key");
    if (existing !== null && existing !== request.idempotencyKey) {
      throw new TypeError("Idempotency-Key header conflicts with request idempotencyKey");
    }
    headers.set("idempotency-key", request.idempotencyKey);
  }
  return { url, method, headers, timeoutMs, responseBytes };
}

export function redirectedOutboundHttpMethod(method: OutboundHttpMethod, status: number): OutboundHttpMethod {
  if (status === 303 && method !== "GET" && method !== "HEAD") return "GET";
  if ((status === 301 || status === 302) && method === "POST") return "GET";
  return method;
}

export function retainCrossOriginSafeHeaders(headers: Headers): Headers {
  const retained = new Headers();
  for (const [name, value] of headers.entries()) {
    if (CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) retained.append(name, value);
  }
  return retained;
}

export function isReplayableOutboundHttpBody(body: BodyInit): boolean {
  return (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob
  );
}

function resolveLimit(value: number | undefined, defaultValue: number, maximum: number, name: string): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}
