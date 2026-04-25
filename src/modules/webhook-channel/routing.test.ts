import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  clearSessions,
  makeWebhookChannelHandler,
  type WebhookSessionFactory,
} from "./handler.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

type CreatedWebhookSession = {
  label: string;
  autonomyMode: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeSessionFactory(created: CreatedWebhookSession[] = []): WebhookSessionFactory {
  return vi.fn(({ label, autonomyMode }) => {
    const send = vi.fn(async () => "agent response text");
    const close = vi.fn();
    created.push({ label, autonomyMode, send, close });
    return { send, close };
  });
}

function makeStubCtx(
  bus?: EventBus,
  moduleConfig?: Record<string, unknown>,
): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: { serve: { defaultAutonomyMode: "supervised" } } as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "webhook-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
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
      listenerCount: (event?: string) => b.listenerCount(event),
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
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
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
  url = "/api/channels/webhook",
): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    headers,
    method: "POST",
    url,
  }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return req;
}

async function invokeHandler(
  ctx: ModuleContext,
  body: string,
  headers: Record<string, string> = {},
  url?: string,
  sessionFactory: WebhookSessionFactory = makeSessionFactory(),
): Promise<FakeResponse> {
  const handler = makeWebhookChannelHandler(
    ctx,
    ctx.getModuleConfig() ?? {},
    sessionFactory,
  );
  const req = makeFakeRequest(body, headers, url);
  const res = makeFakeResponse();
  await handler(req, res as unknown as ServerResponse);
  return res;
}

const SOURCES_CONFIG = {
  sources: {
    github: { agent: "builder" },
    ci: { agent: "reviewer" },
    monitoring: { agent: "ops" },
  },
};

beforeEach(() => {
  clearSessions();
});

// ─── Source routing via path suffix ─────────────────────────────────────────

describe("source routing — path suffix", () => {
  it("routes to configured source (HTTP 201)", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "PR merged" });
    const res = await invokeHandler(ctx, body, {}, "/api/channels/webhook/github");

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body!);
    expect(parsed.source).toBe("github");
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.response).toBe("agent response text");
  });

  it("includes source agent in session label", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const created: CreatedWebhookSession[] = [];
    const body = JSON.stringify({ message: "Build passed" });
    await invokeHandler(
      ctx,
      body,
      {},
      "/api/channels/webhook/ci",
      makeSessionFactory(created),
    );

    expect(created[0].label).toBe("webhook:ci:reviewer");
    expect(created[0].autonomyMode).toBe("supervised");
  });
});

// ─── Source routing via header ──────────────────────────────────────────────

describe("source routing — X-Webhook-Source header", () => {
  it("routes via header value", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Alert fired" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-source": "monitoring",
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBe("monitoring");
  });
});

// ─── Source routing via payload field ────────────────────────────────────────

describe("source routing — payload source field", () => {
  it("routes via source payload field", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Deployed", source: "github" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBe("github");
  });
});

// ─── Source identification priority ─────────────────────────────────────────

describe("source identification priority", () => {
  it("path takes precedence over header and payload", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Mixed", source: "ci" });
    const res = await invokeHandler(
      ctx,
      body,
      { "x-webhook-source": "monitoring" },
      "/api/channels/webhook/github",
    );

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBe("github");
  });

  it("header takes precedence over payload field", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Mixed", source: "github" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-source": "ci",
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBe("ci");
  });
});

// ─── Session continuity per source ──────────────────────────────────────────

describe("source session continuity", () => {
  it("resumes session for same source (HTTP 200)", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);

    const res1 = await invokeHandler(
      ctx,
      JSON.stringify({ message: "First" }),
      { "x-webhook-source": "github" },
    );
    expect(res1.statusCode).toBe(201);
    const sessionId = JSON.parse(res1.body!).sessionId;

    const res2 = await invokeHandler(
      ctx,
      JSON.stringify({ message: "Second" }),
      { "x-webhook-source": "github" },
    );
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body!).sessionId).toBe(sessionId);
  });

  it("creates separate sessions for different sources", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);

    const res1 = await invokeHandler(
      ctx,
      JSON.stringify({ message: "From GH" }),
      { "x-webhook-source": "github" },
    );
    const res2 = await invokeHandler(
      ctx,
      JSON.stringify({ message: "From CI" }),
      { "x-webhook-source": "ci" },
    );

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(JSON.parse(res1.body!).sessionId).not.toBe(
      JSON.parse(res2.body!).sessionId,
    );
  });

  it("does not require explicit sessionId for continuity", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);

    await invokeHandler(
      ctx,
      JSON.stringify({ message: "First" }),
      {},
      "/api/channels/webhook/monitoring",
    );
    const res2 = await invokeHandler(
      ctx,
      JSON.stringify({ message: "Second" }),
      { "x-webhook-source": "monitoring" },
    );

    expect(res2.statusCode).toBe(200);
  });
});

// ─── Misconfigured source rejection ─────────────────────────────────────────

describe("misconfigured source rejection", () => {
  it("rejects unknown source via path (HTTP 404)", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Unknown" });
    const res = await invokeHandler(ctx, body, {}, "/api/channels/webhook/unknown");

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body!).error).toContain("Unknown source");
    expect(JSON.parse(res.body!).error).toContain("unknown");
  });

  it("rejects unknown source via header (HTTP 404)", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Unknown" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-source": "nonexistent",
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body!).error).toContain("Unknown source");
  });

  it("rejects unknown source via payload (HTTP 404)", async () => {
    const ctx = makeStubCtx(undefined, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Unknown", source: "bad" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(404);
  });
});

// ─── Direct requests without source routing ─────────────────────────────────

describe("direct requests — no sources configured", () => {
  it("works without sources config", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ message: "Normal request" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body!);
    expect(parsed.sessionId).toBeTruthy();
    expect(parsed.source).toBeUndefined();
  });

  it("ignores source header when sources not configured", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ message: "With header" });
    const res = await invokeHandler(ctx, body, {
      "x-webhook-source": "github",
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBeUndefined();
  });

  it("ignores source payload field when sources not configured", async () => {
    const ctx = makeStubCtx();
    const body = JSON.stringify({ message: "With field", source: "github" });
    const res = await invokeHandler(ctx, body);

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body!).source).toBeUndefined();
  });
});

// ─── Source routing events ──────────────────────────────────────────────────

describe("source routing — events", () => {
  it("emits event with source field for source-routed sessions", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("webhook-channel.session", (p) =>
      received.push(p as Record<string, unknown>),
    );

    const ctx = makeStubCtx(bus, SOURCES_CONFIG);
    const body = JSON.stringify({ message: "Event test" });
    await invokeHandler(ctx, body, { "x-webhook-source": "github" });

    expect(received).toHaveLength(1);
    expect(received[0].source).toBe("github");
    expect(received[0].resumed).toBe(false);
  });

  it("marks event as resumed for follow-up source requests", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("webhook-channel.session", (p) =>
      received.push(p as Record<string, unknown>),
    );

    const ctx = makeStubCtx(bus, SOURCES_CONFIG);
    await invokeHandler(
      ctx,
      JSON.stringify({ message: "First" }),
      { "x-webhook-source": "github" },
    );
    await invokeHandler(
      ctx,
      JSON.stringify({ message: "Second" }),
      { "x-webhook-source": "github" },
    );

    expect(received).toHaveLength(2);
    expect(received[0].resumed).toBe(false);
    expect(received[1].resumed).toBe(true);
  });
});
