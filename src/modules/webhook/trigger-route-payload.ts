import type { IncomingMessage } from "node:http";
import {
  hashIdempotencyMaterial,
  type IdempotencyJsonObject,
  type IdempotencyJsonValue,
} from "#core/daemon/idempotency-store.js";
import type { WebhookRunPayload } from "#core/workflow/workflow-dispatcher-provider.js";

const WEBHOOK_TRIGGER_INTERNAL_HEADERS = new Set([
  "x-kota-webhook-signature",
  "x-kota-webhook-timestamp",
  "x-kota-idempotency-key",
  "idempotency-key",
]);
const SECRET_BEARING_WEBHOOK_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-forwarded-auth",
  "x-forwarded-authorization",
  "x-api-key",
  "x-auth-token",
  "x-original-auth",
  "x-original-authorization",
]);
const SECRET_BEARING_HEADER_SUFFIXES = new Set([
  "authorization",
  "token",
  "key",
  "secret",
]);

type ParsedWebhookBody = {
  body: WebhookRunPayload["body"];
  bodyIdempotencyMaterial?: string;
};

function trimmedHeader(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isJsonObject(value: IdempotencyJsonValue): value is IdempotencyJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringProperty(
  value: IdempotencyJsonValue,
  key: string,
): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function isWebhookTriggerInternalHeader(headerName: string): boolean {
  return WEBHOOK_TRIGGER_INTERNAL_HEADERS.has(headerName.toLowerCase());
}

function isSecretBearingWebhookHeader(headerName: string): boolean {
  const normalized = headerName.toLowerCase();
  if (SECRET_BEARING_WEBHOOK_HEADERS.has(normalized)) return true;
  const parts = normalized.split(/[-_]/);
  const suffix = parts[parts.length - 1];
  return SECRET_BEARING_HEADER_SUFFIXES.has(suffix);
}

function parseWebhookBody(rawBody: Buffer): ParsedWebhookBody {
  if (rawBody.length > 0) {
    try {
      const body = JSON.parse(rawBody.toString()) as IdempotencyJsonValue;
      const bodyKey =
        stringProperty(body, "idempotencyKey") ??
        stringProperty(body, "externalId");
      return {
        body,
        ...(bodyKey
          ? { bodyIdempotencyMaterial: `webhook-body-key:${hashIdempotencyMaterial([bodyKey])}` }
          : {}),
      };
    } catch {
      return { body: rawBody.toString() };
    }
  }
  return { body: null };
}

function webhookIdempotencyKey(
  req: IncomingMessage,
  rawBody: Buffer,
  parsed: ParsedWebhookBody,
): string {
  const headerKey =
    trimmedHeader(req, "x-kota-idempotency-key") ??
    trimmedHeader(req, "idempotency-key");
  if (headerKey) {
    return `webhook-header:${hashIdempotencyMaterial([headerKey])}`;
  }
  if (parsed.bodyIdempotencyMaterial) return parsed.bodyIdempotencyMaterial;
  return `webhook-body:${hashIdempotencyMaterial([rawBody.toString("base64")])}`;
}

export function buildWebhookRunPayload(
  req: IncomingMessage,
  rawBody: Buffer,
): WebhookRunPayload {
  const parsed = parseWebhookBody(rawBody);
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (
      !isWebhookTriggerInternalHeader(key) &&
      !isSecretBearingWebhookHeader(key) &&
      typeof val === "string"
    ) {
      headers[key] = val;
    }
  }
  return {
    body: parsed.body,
    headers,
    timestamp: new Date().toISOString(),
    idempotencyKey: webhookIdempotencyKey(req, rawBody, parsed),
  };
}
