/**
 * Exercises the webhook module's signature-validated workflow-trigger
 * control route end-to-end through the daemon-control server. The test
 * mounts `webhookTriggerControlRoutes` against a live `DaemonControlServer`
 * and verifies the same wire contract the route used to satisfy from core.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerDefinitions,
  registerDispatcher,
  signBodyOnly,
  signTimestamped,
  startWebhookRouteTestServer,
  WEBHOOK_SECRET,
  type WebhookRouteTestServer,
} from "./trigger-route-test-support.js";

describe("webhook module signature-validated trigger route", () => {
  let server: WebhookRouteTestServer;

  beforeEach(async () => {
    server = await startWebhookRouteTestServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("returns 200 with runId when signature is correct", async () => {
    registerDispatcher({ ok: true, runId: "2026-01-01T00-00-00-000Z-deploy-abc123" });
    const bodyStr = JSON.stringify({ ref: "refs/heads/main" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, bodyStr),
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      runId: "2026-01-01T00-00-00-000Z-deploy-abc123",
    });
  });

  it("returns 401 when signature header is missing", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": "sha256=badhex" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature hex has malformed trailing data", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": `${signBodyOnly(WEBHOOK_SECRET, "")}zz`,
      },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no secret is configured for the workflow", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(
      `http://127.0.0.1:${server.port}/webhooks/unknown-secret`,
      {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
      },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when workflow not found", async () => {
    registerDispatcher({ ok: false, notFound: true });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when workflow is already running", async () => {
    registerDispatcher({ ok: false, alreadyRunning: true });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(409);
  });

  it("does not require daemon Bearer token", async () => {
    registerDispatcher({ ok: true, runId: "no-bearer-runid" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(200);
  });

  it("forwards JSON body, headers, and timestamp into the dispatcher payload", async () => {
    const fn = registerDispatcher({ ok: true, runId: "test-run-id" });
    const bodyStr = JSON.stringify({ event: "push" });
    const timestamp = String(Date.now());
    await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signTimestamped(
          WEBHOOK_SECRET,
          timestamp,
          bodyStr,
        ),
        "X-Kota-Webhook-Timestamp": timestamp,
        "X-Kota-Idempotency-Key": "delivery-42",
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    expect(fn).toHaveBeenCalledWith(
      "deploy",
      expect.objectContaining({
        body: { event: "push" },
        headers: expect.objectContaining({ "content-type": "application/json" }),
        timestamp: expect.any(String),
        idempotencyKey: expect.any(String),
      }),
    );
    const passedHeaders = fn.mock.calls[0][1].headers;
    expect(passedHeaders).not.toHaveProperty("x-kota-webhook-signature");
    expect(passedHeaders).not.toHaveProperty("x-kota-webhook-timestamp");
    expect(passedHeaders).not.toHaveProperty("x-kota-idempotency-key");
  });

  it("returns 429 with Retry-After header when rate limit is exceeded", async () => {
    registerDispatcher({ ok: true, runId: "rate-limit" });
    registerDefinitions({ deploy: { maxPerMinute: 2 } });
    const sig = signBodyOnly(WEBHOOK_SECRET, "");
    for (let i = 0; i < 2; i++) {
      const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sig },
      });
      expect(res.status).toBe(200);
    }
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sig },
    });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter!, 10)).toBeGreaterThan(0);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("rate limit") });
    expect(typeof body.retryAfterSec).toBe("number");
  });
});
