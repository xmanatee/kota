import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleTools } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import googleWorkspaceModule from "./index.js";

function makeCtx(
  config?: Record<string, unknown>,
  bus: EventBus = new EventBus(),
): ModuleRuntimeContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: {} as ModuleRuntimeContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn().mockReturnValue([]),
    getContributedControlRoutes: vi.fn().mockReturnValue([]),
    getContributedWorkflows: vi.fn().mockReturnValue([]),
    getContributedChannels: vi.fn().mockReturnValue([]),
    getModuleConfig: vi.fn().mockReturnValue(config),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ModuleRuntimeContext["log"],
    getSecret: vi.fn().mockReturnValue(null),
    listTools: vi.fn().mockReturnValue([]),
    events: makeStubEventProxy(bus),
    createSession: vi.fn() as unknown as ModuleRuntimeContext["createSession"],
    registerProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(null),
    callTool: vi.fn() as unknown as ModuleRuntimeContext["callTool"],
    registerMiddleware: vi.fn(),
    getModuleSummaries: vi.fn().mockReturnValue([]),
    registerDynamicStateProvider: vi.fn(),
    registerCleanupHook: vi.fn(),
    registerPreSendHook: vi.fn(),
    registerHarnessHook: vi.fn(),
    resolveAgentDef: vi.fn().mockReturnValue(undefined),
    resolveSkillsPrompt: vi.fn().mockReturnValue(""),
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
    client: {} as never,
  };
}

type FakeResponse = {
  statusCode: number | null;
  body: string | null;
  headers: Record<string, string>;
  setHeader: (key: string, value: string) => void;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

function makeFakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) {
      res.headers[key] = value;
    },
    writeHead(code) {
      res.statusCode = code;
    },
    end(body) {
      res.body = body ?? "";
    },
  };
  return res;
}

function makeFakeRequest(body: string): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, { headers: {} }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return req;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("google-workspace module metadata", () => {
  it("has correct name and version", () => {
    expect(googleWorkspaceModule.name).toBe("google-workspace");
    expect(googleWorkspaceModule.version).toBe("1.0.0");
  });
});

describe("google-workspace module tools()", () => {
  it("returns empty array when config is missing", () => {
    const ctx = makeCtx(undefined);
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns empty array when clientId is missing", () => {
    const ctx = makeCtx({ clientSecret: "s", refreshToken: "r" });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns empty array when env var references are unset", () => {
    delete process.env.UNSET_CID;
    delete process.env.UNSET_CS;
    delete process.env.UNSET_RT;
    const ctx = makeCtx({
      clientId: "$UNSET_CID",
      clientSecret: "$UNSET_CS",
      refreshToken: "$UNSET_RT",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns 7 tools with valid config", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toHaveLength(7);

    const names = tools.map((t) => t.tool.name);
    expect(names).toEqual([
      "gmail_list_messages",
      "gmail_get_message",
      "gmail_send",
      "calendar_list_events",
      "calendar_create_event",
      "drive_list_files",
      "drive_read_file",
    ]);
  });

  it("marks destructive tools correctly", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    const destructive = tools
      .filter((t) => t.effect.kind === "destructive")
      .map((t) => t.tool.name);
    expect(destructive).toEqual(["gmail_send", "calendar_create_event"]);
  });

  it("marks read-only tools correctly", () => {
    const ctx = makeCtx({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    const reads = tools
      .filter((t) => t.effect.kind === "read")
      .map((t) => t.tool.name);
    expect(reads).toEqual([
      "gmail_list_messages",
      "gmail_get_message",
      "calendar_list_events",
      "drive_list_files",
      "drive_read_file",
    ]);
  });

  it("logs warning when config is missing", () => {
    const ctx = makeCtx(undefined);
    resolveModuleTools(googleWorkspaceModule, ctx);
    expect(ctx.log.warn).toHaveBeenCalled();
  });
});

describe("google-workspace module inbound routes", () => {
  it("does not register inbound routes without configured inbound sources", () => {
    const routes = googleWorkspaceModule.routes?.(
      makeCtx({
        clientId: "cid",
        clientSecret: "cs",
        refreshToken: "rt",
      }),
    );

    expect(routes).toEqual([]);
  });

  it("emits a typed inbound signal for a configured Gmail message source", async () => {
    const bus = new EventBus();
    const emitted: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (payload) =>
      emitted.push(payload as Record<string, unknown>),
    );
    const ctx = makeCtx(
      {
        clientId: "cid",
        clientSecret: "cs",
        refreshToken: "rt",
        userId: "owner@example.com",
        inbound: {
          accountId: "owner@example.com",
          trustedSenders: ["alice@example.com"],
        },
      },
      bus,
    );
    const route = googleWorkspaceModule.routes?.(ctx).find((candidate) =>
      candidate.path.endsWith("/gmail"),
    );
    if (!route) throw new Error("expected Gmail inbound route");
    const res = makeFakeResponse();

    await route.handler(
      makeFakeRequest(
        JSON.stringify({
          id: "gmail-msg-2",
          threadId: "thread-2",
          internalDate: "1779680040000",
          snippet: "Please capture this",
          payload: {
            headers: [
              { name: "From", value: "Alice Example <alice@example.com>" },
              { name: "To", value: "owner@example.com" },
              { name: "Subject", value: "Capture follow-up" },
              { name: "Date", value: "Mon, 25 May 2026 03:24:00 +0000" },
              { name: "Message-ID", value: "<gmail-msg-2@example.com>" },
            ],
            body: {
              data: Buffer.from("Please capture this in the queue.").toString(
                "base64url",
              ),
            },
          },
        }),
      ),
      res as unknown as ServerResponse,
      {},
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      event: inboundSignalReceived.name,
      projectId: deriveProjectId("/tmp/test"),
      channel: "gmail.message",
      actorTrust: "trusted",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      projectId: deriveProjectId("/tmp/test"),
      provider: "google-workspace",
      channel: "gmail.message",
      actor: { trust: "trusted" },
      sourceId: "google:gmail:owner@example.com:message:gmail-msg-2",
      body: {
        kind: "message",
        text: expect.stringContaining("Please capture this in the queue."),
      },
    });
  });

  it("emits a typed inbound signal for a configured Calendar change source", async () => {
    const bus = new EventBus();
    const emitted: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (payload) =>
      emitted.push(payload as Record<string, unknown>),
    );
    const ctx = makeCtx(
      {
        clientId: "cid",
        clientSecret: "cs",
        refreshToken: "rt",
        calendarId: "primary",
        inbound: {
          accountId: "owner@example.com",
          trustedOrganizers: ["organizer@example.com"],
        },
      },
      bus,
    );
    const route = googleWorkspaceModule.routes?.(ctx).find((candidate) =>
      candidate.path.endsWith("/calendar"),
    );
    if (!route) throw new Error("expected Calendar inbound route");
    const res = makeFakeResponse();

    await route.handler(
      makeFakeRequest(
        JSON.stringify({
          event: {
            id: "calendar-event-2",
            status: "confirmed",
            summary: "Planning review",
            htmlLink: "https://calendar.google.com/event?eid=calendar-event-2",
            updated: "2026-05-25T03:20:00.000Z",
            organizer: {
              email: "organizer@example.com",
              displayName: "Organizer",
            },
            start: { dateTime: "2026-05-25T09:00:00.000Z" },
            end: { dateTime: "2026-05-25T09:30:00.000Z" },
          },
        }),
      ),
      res as unknown as ServerResponse,
      {},
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      event: inboundSignalReceived.name,
      projectId: deriveProjectId("/tmp/test"),
      channel: "calendar.event",
      actorTrust: "trusted",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      provider: "google-workspace",
      channel: "calendar.event",
      actor: { trust: "trusted" },
      sourceId:
        "google:calendar:owner@example.com:primary:event:calendar-event-2",
      body: {
        kind: "action",
        action: "google.calendar.event.changed",
        data: { calendarId: "primary" },
      },
    });
  });
});
