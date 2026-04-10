import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import githubWebhookModule from "./index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStubCtx(
  bus: EventBus,
  config?: unknown,
  logWarn = vi.fn(),
): ModuleContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "github-webhook"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => config as never,
    log: { info: () => {}, warn: logWarn, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: (event, payload) => bus.emit(event, payload as never),
      subscribe: (event, handler) => bus.on(event, handler as never),
    },
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
  };
}

type FakeResponse = {
  statusCode: number | null;
  body: string | null;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

function makeFakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    body: null,
    writeHead(code) {
      res.statusCode = code;
    },
    end(body) {
      res.body = body ?? "";
    },
  };
  return res;
}

function makeFakeRequest(
  body: string,
  headers: Record<string, string>,
): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, { headers }) as unknown as IncomingMessage;
  // Emit body asynchronously so the handler can attach listeners first.
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return req;
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(Buffer.from(body)).digest("hex")}`;
}

const SECRET = "test-secret-abc";
const PUSH_BODY = JSON.stringify({
  ref: "refs/heads/main",
  repository: { full_name: "owner/repo" },
  commits: [{}, {}],
  pusher: { name: "alice" },
});

async function invokeHandler(
  module: typeof githubWebhookModule,
  ctx: ModuleContext,
  body: string,
  headers: Record<string, string>,
): Promise<FakeResponse> {
  const routes = module.routes!(ctx);
  const route = routes[0];
  const req = makeFakeRequest(body, headers);
  const res = makeFakeResponse();
  await route.handler(req, res as unknown as ServerResponse);
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("githubWebhookModule metadata", () => {
  it("has correct name and version", () => {
    expect(githubWebhookModule.name).toBe("github-webhook");
    expect(githubWebhookModule.version).toBe("1.0.0");
    expect(githubWebhookModule.description).toBeTruthy();
  });

  it("has no tools, commands, channels, workflows, onLoad, or onUnload", () => {
    expect(githubWebhookModule.tools).toBeUndefined();
    expect(githubWebhookModule.commands).toBeUndefined();
    expect(githubWebhookModule.channels).toBeUndefined();
    expect(githubWebhookModule.workflows).toBeUndefined();
    expect(githubWebhookModule.onLoad).toBeUndefined();
    expect(githubWebhookModule.onUnload).toBeUndefined();
  });

  it("sets bypassAuth:true on its route so GitHub deliveries work without KOTA auth", () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET });
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].bypassAuth).toBe(true);
  });
});

describe("githubWebhookModule routes registration", () => {
  it("returns no routes when secret is missing", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, undefined, warnSpy);
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no secret"));
  });

  it("returns no routes when env var is unset", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { secret: "$GITHUB_WEBHOOK_SECRET_UNSET_XYZ" }, warnSpy);
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unset"));
  });

  it("registers POST /api/webhooks/github when secret is present", () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET });
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/webhooks/github");
  });
});

describe("githubWebhookModule handler — signature validation", () => {
  it("rejects delivery with missing signature header (HTTP 401)", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET });
    const res = await invokeHandler(githubWebhookModule, ctx, PUSH_BODY, {
      "x-github-event": "push",
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!)).toMatchObject({ error: "Missing signature" });
  });

  it("rejects delivery with invalid signature (HTTP 401)", async () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { secret: SECRET }, warnSpy);
    const res = await invokeHandler(githubWebhookModule, ctx, PUSH_BODY, {
      "x-hub-signature-256": "sha256=badhash",
      "x-github-event": "push",
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!)).toMatchObject({ error: "Invalid signature" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid HMAC"));
  });

  it("rejects delivery with correct signature for different body", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET });
    const wrongSig = sign(SECRET, '{"other":"payload"}');
    const res = await invokeHandler(githubWebhookModule, ctx, PUSH_BODY, {
      "x-hub-signature-256": wrongSig,
      "x-github-event": "push",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("githubWebhookModule handler — event filtering", () => {
  it("ignores event types not in configured list (HTTP 200 ignored:true)", async () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET, events: ["pull_request"] });
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "push",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({ ok: true, ignored: true, event: "push" });
  });
});

describe("githubWebhookModule handler — event emission", () => {
  it("emits github.push event with normalized payload on valid push delivery", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.push", (p) => received.push(p as Record<string, unknown>));

    const ctx = makeStubCtx(bus, { secret: SECRET });
    const res = await invokeHandler(githubWebhookModule, ctx, PUSH_BODY, {
      "x-hub-signature-256": sign(SECRET, PUSH_BODY),
      "x-github-event": "push",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({ ok: true, event: "github.push" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      repo: "owner/repo",
      ref: "refs/heads/main",
      branch: "main",
      commits: 2,
      pusher: "alice",
    });
  });

  it("emits github.pull_request event with normalized payload", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.pull_request", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "opened",
      number: 42,
      repository: { full_name: "owner/repo" },
      pull_request: {
        title: "Fix bug",
        state: "open",
        merged: false,
        head: { ref: "feature-branch", repo: { full_name: "owner/repo" } },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(res.statusCode).toBe(200);
    expect(received[0]).toMatchObject({
      repo: "owner/repo",
      action: "opened",
      number: 42,
      title: "Fix bug",
      headBranch: "feature-branch",
      baseBranch: "main",
      headRepo: "owner/repo",
      isFork: false,
    });
  });

  it("emits isFork:true when head repo differs from base repo", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.pull_request", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "opened",
      number: 7,
      repository: { full_name: "owner/repo" },
      pull_request: {
        title: "Fork PR",
        state: "open",
        merged: false,
        head: { ref: "fix-branch", repo: { full_name: "contributor/repo" } },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(received[0]).toMatchObject({
      headRepo: "contributor/repo",
      isFork: true,
    });
  });

  it("emits isFork:null when head.repo is absent from payload", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.pull_request", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "opened",
      number: 8,
      repository: { full_name: "owner/repo" },
      pull_request: {
        title: "PR without head repo",
        state: "open",
        merged: false,
        head: { ref: "feature-branch" },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(received[0]).toMatchObject({
      headRepo: null,
      isFork: null,
    });
  });

  it("emits github.check_run event with normalized payload", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.check_run", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "completed",
      repository: { full_name: "owner/repo" },
      check_run: { name: "CI", status: "completed", conclusion: "success" },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "check_run",
    });

    expect(res.statusCode).toBe(200);
    expect(received[0]).toMatchObject({
      repo: "owner/repo",
      action: "completed",
      name: "CI",
      status: "completed",
      conclusion: "success",
    });
  });

  it("accepts all three default events when no events config is set", async () => {
    const bus = new EventBus();
    const emitted: string[] = [];
    for (const ev of ["github.push", "github.pull_request", "github.check_run"]) {
      bus.on(ev, () => emitted.push(ev));
    }
    const ctx = makeStubCtx(bus, { secret: SECRET });

    for (const [eventType, body] of [
      ["push", JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "r/r" } })],
      ["pull_request", JSON.stringify({ repository: { full_name: "r/r" }, pull_request: {} })],
      ["check_run", JSON.stringify({ repository: { full_name: "r/r" }, check_run: {} })],
    ] as [string, string][]) {
      await invokeHandler(githubWebhookModule, ctx, body, {
        "x-hub-signature-256": sign(SECRET, body),
        "x-github-event": eventType,
      });
    }

    expect(emitted).toContain("github.push");
    expect(emitted).toContain("github.pull_request");
    expect(emitted).toContain("github.check_run");
  });
});
