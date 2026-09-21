import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleTools } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { type InboundSignalJsonValue, inboundSignalReceived } from "#modules/inbound-signals/events.js";
import googleWorkspaceModule from "./index.js";

function makeCtx(
  config?: Record<string, unknown>,
  bus: EventBus = new EventBus(),
): ModuleRuntimeContext {
  return {
    cwd: "/tmp",
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: {} as ModuleRuntimeContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn().mockReturnValue([]),
    getContributedControlRoutes: vi.fn().mockReturnValue([]),
    getContributedWorkflows: vi.fn().mockReturnValue([]),
    getContributedChannels: vi.fn().mockReturnValue([]),
      getContributedUiSurfaces: () => [],
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

  it("returns empty array when secret references are unset", () => {
    const ctx = makeCtx({
      clientId: "$UNSET_CID",
      clientSecret: "$UNSET_CS",
      refreshToken: "$UNSET_RT",
    });
    const tools = resolveModuleTools(googleWorkspaceModule, ctx);
    expect(tools).toEqual([]);
  });

  it("returns tools when config references setup-stored secrets", () => {
    const ctx = makeCtx({
      clientId: "$GOOGLE_CLIENT_ID",
      clientSecret: "$GOOGLE_CLIENT_SECRET",
      refreshToken: "$GOOGLE_REFRESH_TOKEN",
    });
    const secrets: Record<string, string> = {
      GOOGLE_CLIENT_ID: "stored-client-id",
      GOOGLE_CLIENT_SECRET: "stored-client-secret",
      GOOGLE_REFRESH_TOKEN: "stored-refresh-token",
    };
    (ctx.getSecret as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => secrets[key] ?? null,
    );

    const tools = resolveModuleTools(googleWorkspaceModule, ctx);

    expect(tools.length).toBeGreaterThan(0);
    expect(ctx.getSecret).toHaveBeenCalledWith("GOOGLE_CLIENT_ID");
    expect(ctx.getSecret).toHaveBeenCalledWith("GOOGLE_CLIENT_SECRET");
    expect(ctx.getSecret).toHaveBeenCalledWith("GOOGLE_REFRESH_TOKEN");
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
            mimeType: "text/plain",
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
      scopeId: deriveDirectoryScopeId("/tmp"),
      channel: "gmail.message",
      actorTrust: "trusted",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      scopeId: deriveDirectoryScopeId("/tmp"),
      provider: "google-workspace",
      channel: "gmail.message",
      actor: { trust: "trusted" },
      sourceId: "google:gmail:owner@example.com",
      body: {
        kind: "message",
        text: expect.stringContaining("Please capture this in the queue."),
      },
    });
  });

  it.each([
    {
      name: "ordinary change", event: {},
      expected: { recurringEventId: null, originalStartTime: null },
    },
    {
      name: "moved timed occurrence",
      event: {
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-05-25T08:00:00+01:00", timeZone: "Europe/London" },
      },
      expected: {
        recurringEventId: "series-1",
        originalStartTime: { date: null, dateTime: "2026-05-25T08:00:00+01:00", timeZone: "Europe/London" },
      },
    },
    {
      name: "sparse timed cancellation",
      event: {
        status: "cancelled", organizer: undefined, start: undefined, end: undefined,
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-05-25T08:00:00Z" },
      },
      expected: {
        recurringEventId: "series-1",
        originalStartTime: { date: null, dateTime: "2026-05-25T08:00:00Z", timeZone: null },
      },
    },
    {
      name: "sparse all-day cancellation",
      event: {
        status: "cancelled", organizer: undefined, start: undefined, end: undefined,
        recurringEventId: "series-1", originalStartTime: { date: "2026-05-25" },
      },
      expected: {
        recurringEventId: "series-1",
        originalStartTime: { date: "2026-05-25", dateTime: null, timeZone: null },
      },
    },
    {
      name: "local time with a named zone",
      event: {
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-05-25T08:00:00", timeZone: "Europe/London" },
      },
      expected: {
        recurringEventId: "series-1",
        originalStartTime: { date: null, dateTime: "2026-05-25T08:00:00", timeZone: "Europe/London" },
      },
    },
    {
      name: "moved all-day occurrence",
      event: {
        recurringEventId: "series-1",
        originalStartTime: { date: "2028-02-29", timeZone: "Europe/London" },
        start: { date: "2028-03-01" }, end: { date: "2028-03-02" },
      },
      expected: {
        recurringEventId: "series-1",
        originalStartTime: { date: "2028-02-29", dateTime: null, timeZone: "Europe/London" },
      },
    },
    {
      name: "single-event deletion",
      event: { status: "cancelled", organizer: undefined, start: undefined, end: undefined },
      expected: { recurringEventId: null, originalStartTime: null },
    },
  ])("emits occurrence metadata for $name through the configured Calendar route", async ({ event, expected }) => {
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

    const input = {
      id: "calendar-event-2",
      status: "confirmed",
      organizer: { email: "organizer@example.com", displayName: "Organizer" },
      start: { dateTime: "2026-05-25T09:00:00.000Z" },
      end: { dateTime: "2026-05-25T09:30:00.000Z" },
      ...event,
    };
    // Both supported request shapes must preserve occurrence identity.
    for (const body of [input, { event: input }]) {
      emitted.length = 0;
      await route.handler(
        makeFakeRequest(JSON.stringify(body)), res as unknown as ServerResponse, {},
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body!)).toMatchObject({
        ok: true,
        event: inboundSignalReceived.name,
        scopeId: deriveDirectoryScopeId("/tmp"),
        channel: "calendar.event",
        actorTrust: input.organizer ? "trusted" : "untrusted",
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        provider: "google-workspace",
        channel: "calendar.event",
        actor: { trust: input.organizer ? "trusted" : "untrusted" },
        sourceId: "google:calendar:owner@example.com:primary",
        body: {
          kind: "action",
          action: input.status === "cancelled" ? "google.calendar.event.cancelled" : "google.calendar.event.changed",
          data: {
            calendarId: "primary", eventId: input.id, ...expected,
            start: input.start ? { date: null, dateTime: null, timeZone: null, ...input.start } : null,
            end: input.end ? { date: null, dateTime: null, timeZone: null, ...input.end } : null,
          },
        },
      });
    }
  });

  it.each<InboundSignalJsonValue>([
    null, "2026-05-25", [], 42, {},
    { date: 20260525 }, { date: null }, { date: "" },
    { date: "2026-02-29" }, { date: "2026-13-01" },
    { date: "2026-05-25", dateTime: "2026-05-25T08:00:00Z" },
    { dateTime: false }, { dateTime: null }, { dateTime: "not-a-time" },
    { dateTime: "2026-02-30T08:00:00Z" }, { dateTime: "2026-05-25T25:00:00Z" },
    { dateTime: "2026-05-25T08:00:00" },
    { dateTime: "2026-05-25T08:00:00Z", timeZone: 1 },
    { dateTime: "2026-05-25T08:00:00Z", timeZone: null },
    { dateTime: "2026-05-25T08:00:00", timeZone: "Mars/Olympus" },
    { dateTime: "2026-05-25T08:00:00", timeZone: "+01:00" },
    { dateTime: "2026-05-25T08:00:00Z", timeZone: "" },
  ])("rejects malformed originalStartTime without emitting: %j", async (originalStartTime) => {
    const bus = new EventBus();
    const emit = vi.fn();
    bus.on(inboundSignalReceived, emit);
    const route = googleWorkspaceModule.routes?.(makeCtx({ inbound: {} }, bus))
      .find((candidate) => candidate.path.endsWith("/calendar"));
    if (!route) throw new Error("expected Calendar inbound route");
    const res = makeFakeResponse();
    await route.handler(
      makeFakeRequest(JSON.stringify({
        id: "cancelled-instance", status: "cancelled", originalStartTime,
      })),
      res as unknown as ServerResponse,
      {},
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body!)).toEqual({ error: expect.stringContaining("originalStartTime") });
    expect(emit).not.toHaveBeenCalled();
  });
});
