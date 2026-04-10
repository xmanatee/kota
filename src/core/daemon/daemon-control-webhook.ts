import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleWebhookRequest(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  workflowName: string,
): void {
  if (!workflowName || !/^[a-zA-Z0-9_-]+$/.test(workflowName)) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }
  readBody(req)
    .then((buf) => {
      const signature = req.headers["x-kota-webhook-signature"];
      if (!signature || typeof signature !== "string") {
        jsonResponse(res, 401, { error: "Missing X-Kota-Webhook-Signature header" });
        return;
      }
      const webhookTimestamp = req.headers["x-kota-webhook-timestamp"];
      let body: unknown = null;
      if (buf.length > 0) {
        try {
          body = JSON.parse(buf.toString()) as unknown;
        } catch {
          body = buf.toString();
        }
      }
      const headers: Record<string, string> = {};
      for (const [key, val] of Object.entries(req.headers)) {
        if (
          key !== "x-kota-webhook-signature" &&
          key !== "x-kota-webhook-timestamp" &&
          typeof val === "string"
        ) {
          headers[key] = val;
        }
      }
      const payload = { body, headers, timestamp: new Date().toISOString() };
      const result = handle.triggerWebhookRun(
        workflowName,
        signature,
        buf,
        payload,
        typeof webhookTimestamp === "string" ? webhookTimestamp : undefined,
      );
      if (result.unauthorized) {
        jsonResponse(res, 401, { error: "Invalid webhook signature" });
        return;
      }
      if (result.notFound) {
        jsonResponse(res, 404, { error: `Workflow "${workflowName}" not found or has no webhook trigger` });
        return;
      }
      if (result.alreadyRunning) {
        jsonResponse(res, 409, { error: `Workflow "${workflowName}" is already running` });
        return;
      }
      if (result.rateLimited) {
        const retryAfterSec = Math.ceil((result.retryAfterMs ?? 60_000) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        jsonResponse(res, 429, { error: `Webhook rate limit exceeded for "${workflowName}"`, retryAfterSec });
        return;
      }
      if (!result.ok) {
        jsonResponse(res, 400, { error: result.error ?? "Failed to start workflow" });
        return;
      }
      jsonResponse(res, 200, { runId: result.runId });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}
