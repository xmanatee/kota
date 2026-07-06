import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerDispatcher,
  resetWorkflowRuntimeProvidersForTest,
  signBodyOnly,
  signTimestamped,
  startWebhookRouteTestServer,
  WEBHOOK_SECRET,
  type WebhookRouteTestServer,
} from "./trigger-route-test-support.js";

describe("webhook trigger route security edges", () => {
  let server: WebhookRouteTestServer;

  beforeEach(async () => {
    server = await startWebhookRouteTestServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("omits sensitive request headers while preserving non-sensitive headers", async () => {
    const fn = registerDispatcher({ ok: true, runId: "test-run-id" });
    const bodyStr = JSON.stringify({ event: "push" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, bodyStr),
        "Content-Type": "application/json",
        Authorization: "Bearer secret-auth",
        Cookie: "session=secret-cookie",
        "Set-Cookie": "session=secret-set-cookie",
        "Proxy-Authorization": "Basic secret-proxy",
        "X-API-Key": "secret-api-key",
        "X-Auth-Token": "secret-auth-token",
        "X-Custom-Token": "secret-custom-token",
        "X-Signing-Key": "secret-signing-key",
        "X-Client-Secret": "secret-client-secret",
        "X-Forwarded-Authorization": "Bearer secret-forwarded",
        "X-Original-Authorization": "Bearer secret-original",
        "X-Forwarded-Auth": "Bearer secret-forwarded-auth",
        "X-Original-Auth": "Bearer secret-original-auth",
        "X-Client-Authorization": "Bearer secret-client-authorization",
        "X-Forwarded-For": "203.0.113.42",
        "X-Forwarded-Host": "deploy.example.test",
        "X-Request-ID": "request-42",
        "X-Source": "ci",
      },
      body: bodyStr,
    });

    expect(res.status).toBe(200);
    const passedHeaders = fn.mock.calls[0][1].headers;
    expect(passedHeaders).toEqual(
      expect.objectContaining({
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.42",
        "x-forwarded-host": "deploy.example.test",
        "x-request-id": "request-42",
        "x-source": "ci",
      }),
    );
    for (const header of [
      "authorization",
      "cookie",
      "set-cookie",
      "proxy-authorization",
      "x-api-key",
      "x-auth-token",
      "x-custom-token",
      "x-signing-key",
      "x-client-secret",
      "x-forwarded-authorization",
      "x-original-authorization",
      "x-forwarded-auth",
      "x-original-auth",
      "x-client-authorization",
    ]) {
      expect(passedHeaders).not.toHaveProperty(header);
    }
    expect(JSON.stringify(fn.mock.calls[0][1])).not.toContain("secret-");
  });

  it("derives a stable idempotency key from repeated signed bodies", async () => {
    const fn = registerDispatcher({ ok: true, runId: "test-run-id" });
    const bodyStr = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    for (let i = 0; i < 2; i++) {
      const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
        method: "POST",
        headers: {
          "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, bodyStr),
          "Content-Type": "application/json",
        },
        body: bodyStr,
      });
      expect(res.status).toBe(200);
    }

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][1].idempotencyKey).toBe(fn.mock.calls[1][1].idempotencyKey);
    expect(fn.mock.calls[0][1].idempotencyKey).toMatch(/^webhook-body:/);
  });

  it("accepts bare hex signature without the sha256= prefix", async () => {
    registerDispatcher({ ok: true, runId: "bare-hex" });
    const bareHex = createHmac("sha256", WEBHOOK_SECRET).update("").digest("hex");
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": bareHex },
    });
    expect(res.status).toBe(200);
  });

  it("rejects body-only signatures that include a timestamp header", async () => {
    const fn = registerDispatcher({ ok: true, runId: "body-only-with-timestamp" });
    const bodyStr = JSON.stringify({ event: "push" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, bodyStr),
        "X-Kota-Webhook-Timestamp": String(Date.now()),
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects timestamp-bound signatures without the timestamp header", async () => {
    const fn = registerDispatcher({ ok: true, runId: "missing-timestamp" });
    const bodyStr = JSON.stringify({ event: "push" });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signTimestamped(
          WEBHOOK_SECRET,
          String(Date.now()),
          bodyStr,
        ),
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects timestamp-bound signatures replayed with a fresh unsigned timestamp", async () => {
    const fn = registerDispatcher({ ok: true, runId: "tampered-timestamp" });
    const bodyStr = JSON.stringify({ event: "push" });
    const signedTimestamp = String(Date.now());
    const replayTimestamp = String(Number(signedTimestamp) + 1000);
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signTimestamped(
          WEBHOOK_SECRET,
          signedTimestamp,
          bodyStr,
        ),
        "X-Kota-Webhook-Timestamp": replayTimestamp,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });

    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects stale timestamp-bound signatures outside the five-minute replay window", async () => {
    registerDispatcher({ ok: true, runId: "stale-ts" });
    const staleTs = String(Date.now() - 10 * 60 * 1000);
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signTimestamped(WEBHOOK_SECRET, staleTs, ""),
        "X-Kota-Webhook-Timestamp": staleTs,
      },
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed workflow names with 404", async () => {
    registerDispatcher({ ok: true, runId: "should-not-be-called" });
    const res = await globalThis.fetch(
      `http://127.0.0.1:${server.port}/webhooks/${encodeURIComponent("bad name")}`,
      {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 503 when the workflow runtime providers are unavailable", async () => {
    resetWorkflowRuntimeProvidersForTest();
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(503);
  });
});
