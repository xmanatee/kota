import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { githubPullRequestEvent } from "./events.js";
import githubWebhookModule from "./index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeStubCtx(
  bus: EventBus,
  config?: unknown,
  logWarn = vi.fn(),
): ModuleRuntimeContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage("/tmp/test", "github-webhook"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => config as never,
    log: { info: () => {}, warn: logWarn, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: makeStubEventProxy(bus),
    createSession: () => ({ send: async () => "", close: () => {} }),
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
    client: {} as never,
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

function issueCommentBody(input?: {
  action?: string;
  body?: string;
  authorAssociation?: string;
  sender?: { login?: string; type?: string };
  commenter?: { login?: string; type?: string };
  isPullRequest?: boolean;
}): string {
  return JSON.stringify({
    action: input?.action ?? "created",
    repository: {
      id: 99,
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
    },
    issue: {
      number: 17,
      title: "Need assistance",
      html_url: "https://github.com/owner/repo/issues/17",
      ...(input?.isPullRequest === false ? {} : { pull_request: {} }),
    },
    comment: {
      id: 1234,
      body: input?.body ?? "@kota please take a look",
      created_at: "2026-05-25T02:40:00.000Z",
      html_url: "https://github.com/owner/repo/issues/17#issuecomment-1234",
      user: input?.commenter ?? { login: "maintainer", type: "User" },
      author_association: input?.authorAssociation ?? "MEMBER",
    },
    sender: input?.sender ?? { login: "maintainer", type: "User" },
  });
}

async function invokeHandler(
  module: typeof githubWebhookModule,
  ctx: ModuleRuntimeContext,
  body: string,
  headers: Record<string, string>,
): Promise<FakeResponse> {
  const routes = module.routes!(ctx);
  const route = routes[0];
  const req = makeFakeRequest(body, headers);
  const res = makeFakeResponse();
  await route.handler(req, res as unknown as ServerResponse, {});
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("githubWebhookModule metadata", () => {
  it("has correct name and version", () => {
    expect(githubWebhookModule.name).toBe("github-webhook");
    expect(githubWebhookModule.version).toBe("1.0.0");
    expect(githubWebhookModule.description).toBeTruthy();
  });

  it("contributes routes, typed event declarations, and a one-time onLoad warning", () => {
    expect(githubWebhookModule.tools).toBeUndefined();
    expect(githubWebhookModule.commands).toBeUndefined();
    expect(githubWebhookModule.channels).toBeUndefined();
    expect(githubWebhookModule.workflows).toBeUndefined();
    expect(githubWebhookModule.events).toEqual([githubPullRequestEvent]);
    expect(githubWebhookModule.dependencies).toEqual(["inbound-signals"]);
    expect(githubWebhookModule.onUnload).toBeUndefined();
    expect(typeof githubWebhookModule.onLoad).toBe("function");
  });

  it("declares every pull-request field required for actor-integrity gating", () => {
    expect(githubPullRequestEvent.name).toBe("github.pull_request");
    expect(githubPullRequestEvent.fields).toEqual([
      "repo",
      "action",
      "number",
      "title",
      "state",
      "merged",
      "headBranch",
      "baseBranch",
      "headRepo",
      "isFork",
      "headSha",
      "sender",
      "prAuthor",
      "authorAssociation",
      "actorIntegrity",
      "actorIntegrityReason",
    ]);
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
  it("returns no routes and emits no warning when secret is missing", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, undefined, warnSpy);
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns no routes and emits no warning when env var is unset", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { secret: "$GITHUB_WEBHOOK_SECRET_UNSET_XYZ" }, warnSpy);
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("registers POST /api/webhooks/github when secret is present", () => {
    const bus = new EventBus();
    const ctx = makeStubCtx(bus, { secret: SECRET });
    const routes = githubWebhookModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/webhooks/github");
  });

  it("repeated routes() calls emit no warnings", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, undefined, warnSpy);
    githubWebhookModule.routes!(ctx);
    githubWebhookModule.routes!(ctx);
    githubWebhookModule.routes!(ctx);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("githubWebhookModule onLoad warnings", () => {
  it("warns once when secret is missing", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, undefined, warnSpy);
    githubWebhookModule.onLoad!(ctx);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no secret"));
  });

  it("warns once when env var is unset", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { secret: "$GITHUB_WEBHOOK_SECRET_UNSET_XYZ" }, warnSpy);
    githubWebhookModule.onLoad!(ctx);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unset"));
  });

  it("does not warn when secret is configured and resolved", () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { secret: SECRET }, warnSpy);
    githubWebhookModule.onLoad!(ctx);
    expect(warnSpy).not.toHaveBeenCalled();
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

  it("acknowledges issue_comment deliveries when the event is not configured", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const ctx = makeStubCtx(bus, { secret: SECRET });
    const body = issueCommentBody();
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      ignored: true,
      event: "issue_comment",
    });
    expect(received).toHaveLength(0);
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
      sender: { login: "maintainer", type: "User" },
      pull_request: {
        title: "Fix bug",
        state: "open",
        merged: false,
        user: { login: "kota-bot", type: "Bot" },
        author_association: "MEMBER",
        head: { ref: "feature-branch", sha: "abc123", repo: { full_name: "owner/repo" } },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(res.statusCode).toBe(200);
    expect(received[0]).toEqual({
      repo: "owner/repo",
      action: "opened",
      number: 42,
      title: "Fix bug",
      state: "open",
      merged: false,
      headBranch: "feature-branch",
      baseBranch: "main",
      headRepo: "owner/repo",
      isFork: false,
      headSha: "abc123",
      sender: { login: "maintainer", type: "User" },
      prAuthor: { login: "kota-bot", type: "Bot" },
      authorAssociation: "MEMBER",
      actorIntegrity: "allowed",
      actorIntegrityReason: "author association 'MEMBER' satisfies the configured trust threshold",
    });
  });

  it("marks pull_request payloads with missing actor trust metadata", async () => {
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
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(received[0]).toMatchObject({
      actorIntegrity: "missing_metadata",
      actorIntegrityReason: expect.stringContaining("sender.login"),
    });
  });

  it("marks pull_request payloads from low-trust authors", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.pull_request", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "opened",
      number: 42,
      repository: { full_name: "owner/repo" },
      sender: { login: "new-contributor", type: "User" },
      pull_request: {
        title: "Fix bug",
        state: "open",
        merged: false,
        user: { login: "new-contributor", type: "User" },
        author_association: "FIRST_TIME_CONTRIBUTOR",
        head: { ref: "kota/task/task-from-new-contributor", sha: "abc123", repo: { full_name: "owner/repo" } },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, { secret: SECRET });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(received[0]).toMatchObject({
      actorIntegrity: "low_trust_actor",
      actorIntegrityReason: "author association 'FIRST_TIME_CONTRIBUTOR' is below the configured trust threshold",
    });
  });

  it("marks configured blocked pull_request actors before trust-threshold checks", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on("github.pull_request", (p) => received.push(p as Record<string, unknown>));

    const body = JSON.stringify({
      action: "opened",
      number: 42,
      repository: { full_name: "owner/repo" },
      sender: { login: "blocked-user", type: "User" },
      pull_request: {
        title: "Fix bug",
        state: "open",
        merged: false,
        user: { login: "blocked-user", type: "User" },
        author_association: "MEMBER",
        head: { ref: "kota/task/task-from-blocked-user", sha: "abc123", repo: { full_name: "owner/repo" } },
        base: { ref: "main" },
      },
    });

    const ctx = makeStubCtx(bus, {
      secret: SECRET,
      actorIntegrity: { blockedActors: ["BLOCKED-USER"] },
    });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "pull_request",
    });

    expect(received[0]).toMatchObject({
      actorIntegrity: "blocked_actor",
      actorIntegrityReason: "blocked actor 'blocked-user' matched github-webhook actorIntegrity.blockedActors",
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

  it("emits only inbound.signal.received for configured mention comments", async () => {
    const bus = new EventBus();
    const legacyMentions: Record<string, unknown>[] = [];
    const inboundSignals: Record<string, unknown>[] = [];
    bus.on("github.issue_comment.mention", (p) =>
      legacyMentions.push(p as Record<string, unknown>),
    );
    bus.on(inboundSignalReceived, (p) =>
      inboundSignals.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody();
    const ctx = makeStubCtx(bus, {
      secret: SECRET,
      events: ["issue_comment"],
      issueComment: { mentionAliases: ["@kota"] },
    });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      event: inboundSignalReceived.name,
    });
    expect(legacyMentions).toHaveLength(0);
    expect(inboundSignals).toHaveLength(1);
    expect(inboundSignals[0]).toMatchObject({
      projectId: deriveProjectId("/tmp/test"),
      provider: "github",
      channel: "github.issue_comment",
      accountId: "github:owner/repo",
      sourceId: "github:owner/repo:issue:17:comment:1234",
      sourceUrl: "https://github.com/owner/repo/issues/17#issuecomment-1234",
      externalId: "github:99:issue_comment:1234",
      occurredAt: "2026-05-25T02:40:00.000Z",
      actor: {
        id: "github:maintainer",
        displayName: "maintainer",
        trust: "trusted",
        trustReason: "author association 'MEMBER' satisfies the configured trust threshold",
      },
      body: {
        kind: "action",
        action: "github.issue_comment.mention",
        data: {
          repo: "owner/repo",
          repositoryId: 99,
          repositoryUrl: "https://github.com/owner/repo",
          action: "created",
          issueNumber: 17,
          issueTitle: "Need assistance",
          issueUrl: "https://github.com/owner/repo/issues/17",
          isPullRequest: true,
          commentId: 1234,
          commentBody: "@kota please take a look",
          commentUrl: "https://github.com/owner/repo/issues/17#issuecomment-1234",
          commenter: { login: "maintainer", type: "User" },
          sender: { login: "maintainer", type: "User" },
          authorAssociation: "MEMBER",
          matchedMentionAlias: "@kota",
          actorIntegrity: "allowed",
          actorIntegrityReason: "author association 'MEMBER' satisfies the configured trust threshold",
          reason: "comment body mentioned configured alias '@kota'",
        },
      },
    });
  });

  it("uses the default mention alias when issue_comment is configured", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({
      body: "Could @KOTA review this issue?",
      isPullRequest: false,
    });
    const ctx = makeStubCtx(bus, { secret: SECRET, events: ["issue_comment"] });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      body: {
        data: {
          isPullRequest: false,
          matchedMentionAlias: "@kota",
        },
      },
    });
  });

  it("does not emit mention events for non-mentions", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({ body: "@kota-bot is not the configured alias" });
    const ctx = makeStubCtx(bus, {
      secret: SECRET,
      events: ["issue_comment"],
      issueComment: { mentionAliases: ["@kota"] },
    });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      ignored: true,
      event: "issue_comment",
      reason: "no_matching_mention",
    });
    expect(received).toHaveLength(0);
  });

  it("does not emit mention events for unsupported issue_comment actions", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({ action: "edited" });
    const ctx = makeStubCtx(bus, {
      secret: SECRET,
      events: ["issue_comment"],
      issueComment: { mentionAliases: ["@kota"] },
    });
    const res = await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      ignored: true,
      event: "issue_comment",
      reason: "unsupported_action",
    });
    expect(received).toHaveLength(0);
  });

  it("marks mention comments with missing actor trust metadata", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({
      sender: {},
      commenter: {},
      authorAssociation: "",
    });
    const ctx = makeStubCtx(bus, { secret: SECRET, events: ["issue_comment"] });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(received[0]).toMatchObject({
      actor: {
        trust: "untrusted",
        trustReason: expect.stringContaining("sender.login"),
      },
      body: {
        data: {
          actorIntegrity: "missing_metadata",
          actorIntegrityReason: expect.stringContaining("comment.user.login"),
        },
      },
    });
  });

  it("marks mention comments from low-trust commenters", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({
      sender: { login: "new-contributor", type: "User" },
      commenter: { login: "new-contributor", type: "User" },
      authorAssociation: "FIRST_TIMER",
    });
    const ctx = makeStubCtx(bus, { secret: SECRET, events: ["issue_comment"] });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(received[0]).toMatchObject({
      actor: {
        trust: "untrusted",
        trustReason: "author association 'FIRST_TIMER' is below the configured trust threshold",
      },
      body: {
        data: {
          actorIntegrity: "low_trust_actor",
          actorIntegrityReason: "author association 'FIRST_TIMER' is below the configured trust threshold",
        },
      },
    });
  });

  it("marks configured blocked mention commenters before trust-threshold checks", async () => {
    const bus = new EventBus();
    const received: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (p) =>
      received.push(p as Record<string, unknown>),
    );

    const body = issueCommentBody({
      sender: { login: "blocked-user", type: "User" },
      commenter: { login: "blocked-user", type: "User" },
      authorAssociation: "MEMBER",
    });
    const ctx = makeStubCtx(bus, {
      secret: SECRET,
      events: ["issue_comment"],
      actorIntegrity: { blockedActors: ["BLOCKED-USER"] },
    });
    await invokeHandler(githubWebhookModule, ctx, body, {
      "x-hub-signature-256": sign(SECRET, body),
      "x-github-event": "issue_comment",
    });

    expect(received[0]).toMatchObject({
      actor: {
        trust: "blocked",
        trustReason: "blocked actor 'blocked-user' matched github-webhook actorIntegrity.blockedActors",
      },
      body: {
        data: {
          actorIntegrity: "blocked_actor",
          actorIntegrityReason: "blocked actor 'blocked-user' matched github-webhook actorIntegrity.blockedActors",
        },
      },
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
