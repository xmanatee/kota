import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebhookTriggerHandler,
  WEBHOOK_TRIGGER_BODY_LIMIT_BYTES,
  WebhookRateLimiter,
} from "./trigger-route.js";
import {
  registerDispatcher,
  resetWorkflowRuntimeProvidersForTest,
  signBodyOnly,
  signTimestamped,
  startWebhookRouteTestServer,
  WEBHOOK_SECRET,
  type WebhookRouteTestServer,
} from "./trigger-route-test-support.js";

function responseRecorder(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
} {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) body += chunk.toString();
      return res;
    },
  } as never as ServerResponse;
  return {
    res,
    status: () => status,
    body: () => body,
  };
}

describe("webhook trigger route security edges", () => {
  let server: WebhookRouteTestServer;

  beforeEach(async () => {
    server = await startWebhookRouteTestServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects unsigned oversized requests before attaching body readers", async () => {
    const getSecret = vi.fn(() => WEBHOOK_SECRET);
    const handler = createWebhookTriggerHandler({
      getSecret,
      rateLimiter: new WebhookRateLimiter(),
    });
    const req = {
      headers: {
        "content-length": String(WEBHOOK_TRIGGER_BODY_LIMIT_BYTES + 1),
      },
      on(event: string) {
        if (event === "data") throw new Error("request body was buffered");
        return req;
      },
    } as never as IncomingMessage;
    const recorder = responseRecorder();

    await handler(req, recorder.res, { name: "deploy" });

    expect(recorder.status()).toBe(401);
    expect(JSON.parse(recorder.body())).toMatchObject({
      error: "Missing X-Kota-Webhook-Signature header",
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("returns 413 for signed payloads over the webhook body cap without dispatching", async () => {
    const fn = registerDispatcher({ ok: true, runId: "oversized-run" });
    const body = Buffer.alloc(WEBHOOK_TRIGGER_BODY_LIMIT_BYTES + 1, "x");
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": signBodyOnly(WEBHOOK_SECRET, body),
        "Content-Type": "application/json",
      },
      body,
    });

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({
      error: "Webhook payload too large",
      limitBytes: WEBHOOK_TRIGGER_BODY_LIMIT_BYTES,
    });
    expect(fn).not.toHaveBeenCalled();
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
