/**
 * Signature-validated workflow-trigger route contributed by the webhook
 * module. External systems POST a JSON payload to
 * `POST /webhooks/:name` with an HMAC-SHA256 signature in
 * `X-Kota-Webhook-Signature` (and an optional `X-Kota-Webhook-Timestamp`
 * to opt into anti-replay) to fire the named workflow.
 *
 * The route bypasses the daemon Bearer-token auth via
 * `ControlRouteRegistration.bypassAuth`; auth is established per request
 * by HMAC verification against the workflow-scoped secret stored in
 * `KotaConfig.webhooks[name].secret`.
 *
 * Workflow runtime access is mediated by the existing
 * `workflow-dispatcher` provider seam plus the read-only
 * `workflow-definitions` source for the per-workflow rate-limit
 * configuration. The sliding 60-second rate-limit window is owned by
 * this module, not by daemon-handle state.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaConfig } from "#core/config/config.js";
import { jsonResponse, readBody } from "#core/daemon/daemon-control-utils.js";
import {
  hashIdempotencyMaterial,
  type IdempotencyJsonObject,
  type IdempotencyJsonValue,
} from "#core/daemon/idempotency-store.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { getWorkflowDefinitionsSource } from "#core/workflow/workflow-definitions-provider.js";
import {
  getWorkflowDispatcher,
  type WebhookRunPayload,
} from "#core/workflow/workflow-dispatcher-provider.js";

const WORKFLOW_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;

type WebhookSecretLookup = (name: string) => string | undefined;
type ParsedWebhookBody = {
  body: WebhookRunPayload["body"];
  bodyIdempotencyMaterial?: string;
};

export class WebhookRateLimiter {
  private readonly windows = new Map<string, number[]>();

  /**
   * Returns `null` when the request is within budget (and records it).
   * Returns the millisecond delay until the oldest entry leaves the
   * window when the cap has been reached. The window is sliding 60s.
   */
  check(name: string, maxPerMinute: number, now: number): number | null {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const timestamps = (this.windows.get(name) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= maxPerMinute) {
      const oldest = timestamps[0];
      return oldest + RATE_LIMIT_WINDOW_MS - now;
    }
    timestamps.push(now);
    this.windows.set(name, timestamps);
    return null;
  }
}

function verifySignature(secret: string, rawBody: Buffer, signature: string): boolean {
  const hexSig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hexSig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function timestampWithinWindow(headerValue: string, now: number): boolean {
  const ts = parseInt(headerValue, 10);
  if (Number.isNaN(ts)) return false;
  return Math.abs(now - ts) <= TIMESTAMP_TOLERANCE_MS;
}

function trimmedHeader(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isJsonObject(value: IdempotencyJsonValue): value is IdempotencyJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringProperty(value: IdempotencyJsonValue, key: string): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
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

function buildPayload(
  req: IncomingMessage,
  rawBody: Buffer,
): WebhookRunPayload {
  const parsed = parseWebhookBody(rawBody);
  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (
      key !== "x-kota-webhook-signature" &&
      key !== "x-kota-webhook-timestamp" &&
      key !== "x-kota-idempotency-key" &&
      key !== "idempotency-key" &&
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

export type WebhookTriggerHandlerOptions = {
  /** Resolves the per-workflow secret. */
  getSecret: WebhookSecretLookup;
  /** Rate-limit window state owned by the caller. */
  rateLimiter: WebhookRateLimiter;
};

export function createWebhookTriggerHandler(
  options: WebhookTriggerHandlerOptions,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  const { getSecret, rateLimiter } = options;
  return async (req, res, params) => {
    const name = params.name;
    if (!name || !WORKFLOW_NAME_PATTERN.test(name)) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readBody(req);
    } catch {
      jsonResponse(res, 500, { error: "Internal error" });
      return;
    }

    const signature = req.headers["x-kota-webhook-signature"];
    if (!signature || typeof signature !== "string") {
      jsonResponse(res, 401, { error: "Missing X-Kota-Webhook-Signature header" });
      return;
    }

    const expectedSecret = getSecret(name);
    if (!expectedSecret || !verifySignature(expectedSecret, rawBody, signature)) {
      jsonResponse(res, 401, { error: "Invalid webhook signature" });
      return;
    }

    const webhookTimestamp = req.headers["x-kota-webhook-timestamp"];
    if (typeof webhookTimestamp === "string" && !timestampWithinWindow(webhookTimestamp, Date.now())) {
      jsonResponse(res, 401, { error: "Invalid webhook signature" });
      return;
    }

    const definitionsSource = getWorkflowDefinitionsSource();
    const dispatcher = getWorkflowDispatcher();
    if (!definitionsSource || !dispatcher) {
      jsonResponse(res, 503, { error: "Workflow runtime unavailable" });
      return;
    }

    const rateLimit = definitionsSource.getWebhookRateLimit(name);
    if (rateLimit) {
      const retryAfterMs = rateLimiter.check(name, rateLimit.maxPerMinute, Date.now());
      if (retryAfterMs !== null) {
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        jsonResponse(res, 429, {
          error: `Webhook rate limit exceeded for "${name}"`,
          retryAfterSec,
        });
        return;
      }
    }

    const payload = buildPayload(req, rawBody);
    const result = dispatcher.enqueueWebhookRun(name, payload);
    if (result.notFound) {
      jsonResponse(res, 404, {
        error: `Workflow "${name}" not found or has no webhook trigger`,
      });
      return;
    }
    if (result.alreadyRunning) {
      jsonResponse(res, 409, { error: `Workflow "${name}" is already running` });
      return;
    }
    if (!result.ok) {
      jsonResponse(res, 400, { error: result.error ?? "Failed to start workflow" });
      return;
    }
    jsonResponse(res, 200, { runId: result.runId });
  };
}

/**
 * Build the daemon-control route registration for the signature-validated
 * webhook trigger. The webhook module wires this from its `controlRoutes`
 * contribution, threading the per-call config lookup through `getConfig`
 * so a config reload is observed on the next request.
 */
export function webhookTriggerControlRoutes(
  getConfig: () => KotaConfig,
): ControlRouteRegistration[] {
  const rateLimiter = new WebhookRateLimiter();
  const handler = createWebhookTriggerHandler({
    getSecret: (name) => getConfig().webhooks?.[name]?.secret,
    rateLimiter,
  });
  return [
    {
      method: "POST",
      path: "/webhooks/:name",
      capabilityScope: "control",
      bypassAuth: true,
      handler,
    },
  ];
}
