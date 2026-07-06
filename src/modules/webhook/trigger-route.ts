/**
 * Signature-validated workflow-trigger route contributed by the webhook
 * module. External systems POST a JSON payload to
 * `POST /webhooks/:name` with an HMAC-SHA256 signature in
 * `X-Kota-Webhook-Signature` to fire the named workflow. Legacy
 * `sha256=<hex>` signatures cover only the raw body and authenticate the
 * sender. Replay-protected `sha256-v2=<hex>` signatures cover
 * `X-Kota-Webhook-Timestamp` plus the raw body.
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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaConfig } from "#core/config/config.js";
import {
  jsonResponse,
  RequestBodyTooLargeError,
  readBody,
} from "#core/daemon/daemon-control-utils.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { getWorkflowDefinitionsSource } from "#core/workflow/workflow-definitions-provider.js";
import { getWorkflowDispatcher } from "#core/workflow/workflow-dispatcher-provider.js";
import {
  precheckWebhookSignatureHeaders,
  timestampWithinWebhookWindow,
  verifyWebhookSignature,
} from "./trigger-route-auth.js";
import { buildWebhookRunPayload } from "./trigger-route-payload.js";

const WORKFLOW_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const RATE_LIMIT_WINDOW_MS = 60_000;
export const WEBHOOK_TRIGGER_BODY_LIMIT_BYTES = 1024 * 1024;

type WebhookSecretLookup = (name: string) => string | undefined;

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

    const signature = req.headers["x-kota-webhook-signature"];
    if (!signature || typeof signature !== "string") {
      jsonResponse(res, 401, { error: "Missing X-Kota-Webhook-Signature header" });
      return;
    }

    const expectedSecret = getSecret(name);
    if (!expectedSecret) {
      jsonResponse(res, 401, { error: "Invalid webhook signature" });
      return;
    }
    const headerPrecheck = precheckWebhookSignatureHeaders(
      signature,
      req.headers["x-kota-webhook-timestamp"],
      Date.now(),
    );
    if (!headerPrecheck.ok) {
      jsonResponse(res, 401, { error: "Invalid webhook signature" });
      return;
    }

    let rawBody: Buffer;
    try {
      rawBody = await readBody(req, {
        limitBytes: WEBHOOK_TRIGGER_BODY_LIMIT_BYTES,
      });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        jsonResponse(res, 413, {
          error: "Webhook payload too large",
          limitBytes: error.limitBytes,
        });
        return;
      }
      jsonResponse(res, 500, { error: "Internal error" });
      return;
    }

    const verification = verifyWebhookSignature(
      expectedSecret,
      rawBody,
      signature,
      req.headers["x-kota-webhook-timestamp"],
    );
    if (!verification.ok) {
      jsonResponse(res, 401, { error: "Invalid webhook signature" });
      return;
    }

    if (
      verification.scheme === "timestamped" &&
      !timestampWithinWebhookWindow(verification.timestamp, Date.now())
    ) {
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

    const payload = buildWebhookRunPayload(req, rawBody);
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
