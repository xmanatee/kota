import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";
import webhookChannelModule from "./index.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeStubCtx(
  bus?: EventBus,
  moduleConfig?: Record<string, unknown>,
): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "webhook-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => moduleConfig as never,
    log: Object.assign(() => {}, {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: () => {},
    }),
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: (event, payload) => b.emit(event, payload as never),
      subscribe: (event, handler) => b.on(event, handler as never),
    },
    createSession: vi.fn(() => ({
      send: vi.fn(async () => "agent response text"),
      close: vi.fn(),
    })),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
  };
}

type FakeResponse = {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | null;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

function makeFakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(code, headers) {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
    },
    end(body) {
      res.body = body ?? "";
    },
  };
  return res;
}

function makeFakeRequest(
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, { headers, method }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return req;
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;
}

async function invokeHandler(
  ctx: ModuleContext,
  body: string,
  headers: Record<string, string> = {},
): Promise<FakeResponse> {
  const routes = webhookChannelModule.routes!(ctx);
  const route = routes[0];
  const req = makeFakeRequest(body, headers);
  const res = makeFakeResponse();
  await route.handler(req, res as unknown as ServerResponse);
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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
});

describe("webhookChannelModule channel adapter", () => {
  it("create returns adapter with start/stop", async () => {
    const ctx = makeStubCtx();
    const channels = await resolveModuleChannels(webhookChannelModule, ctx);
    const adapter = channels[0].create({
      projectDir: "/tmp",
      log: () => {},
      getWorkflowStatus: () => ({
        runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
        dispatchPaused: false,
        runsDir: "/tmp/.kota/runs",
      }),
    });
    expect(adapter).not.toBeNull();
    expect(adapter).toHaveProperty("start");
    expect(adapter).toHaveProperty("stop");
  });
});

describe("webhookChannelModule handler — no secret (open mode)", () => {
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

  it("calls ctx.createSession with a webhook label", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ message: "Test" });
    await invokeHandler(ctx, body);

    expect(ctx.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        label: expect.stringContaining("webhook:"),
      }),
    );
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

describe("webhookChannelModule handler — HMAC verification", () => {
  const SECRET = "webhook-test-secret";

  it("accepts valid HMAC signature (HTTP 201)", async () => {
    const ctx = makeStubCtx(undefined, { secret: SECRET });
    const body = JSON.stringify({ message: "Signed payload" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-signature": sign(SECRET, body),
    });

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body!);
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.response).toBe("agent response text");
  });

  it("rejects missing signature when secret is configured (HTTP 401)", async () => {
    const ctx = makeStubCtx(undefined, { secret: SECRET });
    const body = JSON.stringify({ message: "No signature" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!).error).toContain("Missing");
  });

  it("rejects invalid signature (HTTP 401)", async () => {
    const ctx = makeStubCtx(undefined, { secret: SECRET });
    const body = JSON.stringify({ message: "Bad sig" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-signature": "sha256=invalidhash",
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!).error).toContain("Invalid signature");
  });

  it("rejects signature computed with wrong secret", async () => {
    const ctx = makeStubCtx(undefined, { secret: SECRET });
    const body = JSON.stringify({ message: "Wrong secret" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-signature": sign("wrong-secret", body),
    });

    expect(res.statusCode).toBe(401);
  });

  it("supports $ENV_VAR secret references", async () => {
    const envKey = "KOTA_TEST_WH_SECRET_12345";
    process.env[envKey] = "env-resolved-secret";
    try {
      const ctx = makeStubCtx(undefined, { secret: `$${envKey}` });
      const body = JSON.stringify({ message: "Env secret" });
      const res = await invokeHandler(ctx, body, {
        "x-webhook-signature": sign("env-resolved-secret", body),
      });
      expect(res.statusCode).toBe(201);
    } finally {
      delete process.env[envKey];
    }
  });
});

describe("webhookChannelModule handler — session resume", () => {
  it("resumes an existing session by sessionId (HTTP 200)", async () => {
    const ctx = makeStubCtx();

    // Create a session first
    const createBody = JSON.stringify({ message: "First message" });
    const createRes = await invokeHandler(ctx, createBody);
    expect(createRes.statusCode).toBe(201);
    const sessionId = JSON.parse(createRes.body!).sessionId;

    // Resume it
    const resumeBody = JSON.stringify({
      message: "Follow-up",
      sessionId,
    });
    const resumeRes = await invokeHandler(ctx, resumeBody);
    expect(resumeRes.statusCode).toBe(200);
    expect(JSON.parse(resumeRes.body!).sessionId).toBe(sessionId);
  });

  it("returns 404 for unknown sessionId", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({
      message: "Resume unknown",
      sessionId: "wh-nonexistent",
    });
    const res = await invokeHandler(ctx, body);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body!).error).toContain("not found");
  });
});

describe("webhookChannelModule handler — metadata and events", () => {
  it("includes metadata in prompt context for new sessions", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({
      message: "Deploy complete",
      metadata: { service: "api", env: "production" },
    });
    await invokeHandler(ctx, body);

    const session = (ctx.createSession as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(session.send).toHaveBeenCalledWith(
      expect.stringContaining("production"),
    );
  });

  it("emits webhook-channel.session event on new session", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("webhook-channel.session", (p) => received.push(p as Record<string, unknown>));

    const ctx = makeStubCtx(bus);
    const body = JSON.stringify({ message: "Emit test" });
    await invokeHandler(ctx, body);

    expect(received).toHaveLength(1);
    expect(received[0].sessionId).toBeTruthy();
    expect(received[0].resumed).toBe(false);
  });
});
