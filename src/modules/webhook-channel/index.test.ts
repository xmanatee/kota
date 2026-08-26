import { beforeEach, describe, expect, it } from "vitest";
import {
  type ModuleRuntimeContext,
  resolveModuleChannels,
} from "#core/modules/module-types.js";
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

// ─── Module metadata ────────────────────────────────────────────────────────

describe("webhookChannelModule metadata", () => {
  it("has correct name and version", () => {
    expect(webhookChannelModule.name).toBe("webhook-channel");
    expect(webhookChannelModule.version).toBe("1.0.0");
    expect(webhookChannelModule.description).toBeTruthy();
  });

  it("contributes a webhook-channel channel def", async () => {
    const ctx = makeStubCtx();
    const channels = await resolveModuleChannels(webhookChannelModule, ctx);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("webhook-channel");
  });

  it("registers POST /api/channels/webhook route with bypassAuth", () => {
    const ctx = makeStubCtx();
    const routes = webhookChannelModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/channels/webhook");
    expect(routes[0].bypassAuth).toBe(true);
  });

  it("registers routes even when session autonomy is not configured", () => {
    const ctx = makeStubCtx();
    ctx.config = {} as ModuleRuntimeContext["config"];

    expect(() => webhookChannelModule.routes!(ctx)).not.toThrow();
  });

  it("registers per-source routes when sources configured", () => {
    const ctx = makeStubCtx(undefined, {
      sources: { github: { agent: "builder" }, ci: { agent: "reviewer" } },
    });
    const routes = webhookChannelModule.routes!(ctx);
    expect(routes).toHaveLength(3);
    expect(routes[0].path).toBe("/api/channels/webhook");
    expect(routes[1].path).toBe("/api/channels/webhook/github");
    expect(routes[2].path).toBe("/api/channels/webhook/ci");
    for (const route of routes) {
      expect(route.bypassAuth).toBe(true);
    }
  });
});

describe("webhookChannelModule channel adapter", () => {
  it("create returns started result with adapter exposing start/stop", async () => {
    const ctx = makeStubCtx();
    const channels = await resolveModuleChannels(webhookChannelModule, ctx);
    const result = channels[0].create({
      getDefaultScopeRuntime: () =>
        ({
          scope: { scopeId: "test-scope", scopeRoot: "/tmp", displayName: "test" },
        }) as never,
      getScopeRuntime: () =>
        ({
          scope: { scopeId: "test-scope", scopeRoot: "/tmp", displayName: "test" },
        }) as never,
      log: () => {},
      reportFailure: () => {},
      getWorkflowStatus: () => ({
        runtimeState: {
          completedRuns: 0,
          pendingRuns: [],
          activeRuns: [],
          workflows: {},
        },
        dispatchPaused: false,
        runsDir: "/tmp/.kota/runs",
      }),
    });
    expect(result.status).toBe("started");
    if (result.status === "started") {
      expect(result.adapter).toHaveProperty("start");
      expect(result.adapter).toHaveProperty("stop");
    }
  });
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
    ctx.config = {} as ModuleRuntimeContext["config"];

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
