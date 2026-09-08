import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { clearSessions } from "./handler.js";
import {
  type CreatedWebhookSession,
  invokeHandler,
  makeSessionFactory,
  makeStubCtx,
} from "./handler-test-support.integration.js";
import webhookChannelModule from "./index.js";

beforeEach(() => {
  clearSessions();
});

it("loads source routes before session autonomy is configured", async () => {
  const loader = new ModuleLoader({ modules: { "webhook-channel": {
    sources: { ci: { agent: "reviewer" } },
  } } });
  loader.setBus(new EventBus());
  try {
    await loader.load(webhookChannelModule);
    const route = loader.getRoutes().find(route => route.path === "/api/channels/webhook/ci");
    expect(route).toMatchObject({ method: "POST", bypassAuth: true });
  } finally {
    await loader.unloadAll();
  }
});

// ─── Handler — no secret (open mode) ────────────────────────────────────────

describe("handler — open mode", () => {
  it("creates a session and returns sessionId + response (HTTP 201)", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ message: "Hello from CI" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body!);
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.response).toBe("agent response text");
    expect(parsed.createdAt).toBeTruthy();
  });

  it("creates a session with a webhook label", async () => {
    const ctx = makeStubCtx();
    const created: CreatedWebhookSession[] = [];
    const body = JSON.stringify({ message: "Test" });
    await invokeHandler(ctx, body, {}, undefined, makeSessionFactory(created));

    expect(created[0].label).toContain("webhook:");
    expect(created[0].autonomyMode).toBe("supervised");
  });

  it("uses the webhook-channel autonomy override when configured", async () => {
    const ctx = makeStubCtx(undefined, { defaultAutonomyMode: "autonomous" });
    const created: CreatedWebhookSession[] = [];
    const body = JSON.stringify({ message: "Test" });
    await invokeHandler(ctx, body, {}, undefined, makeSessionFactory(created));

    expect(created[0].autonomyMode).toBe("autonomous");
  });

  it("rejects requests when session autonomy is not configured", async () => {
    const ctx = makeStubCtx();
    ctx.config = {};

    const res = await invokeHandler(ctx, JSON.stringify({ message: "Test" }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toContain("autonomy mode is not configured");
  });

  it("rejects missing message field (HTTP 400)", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ agent: "builder" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toContain("message");
  });

  it("rejects invalid JSON body (HTTP 400)", async () => {
    const ctx = makeStubCtx();
    const res = await invokeHandler(ctx, "not-json");

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!).error).toContain("Invalid JSON");
  });

  it("rejects empty body (HTTP 400)", async () => {
    const ctx = makeStubCtx();
    const res = await invokeHandler(ctx, "");

    expect(res.statusCode).toBe(400);
  });
});
