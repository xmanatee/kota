import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import socialModule from "./index.js";

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
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ModuleRuntimeContext["log"],
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

function makeFakeRequest(
  body: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, { headers }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(body));
    emitter.emit("end");
  });
  return req;
}

function socialConfig(): Record<string, unknown> {
  return {
    inbound: {
      connectors: [
        {
          id: "x-owner",
          provider: "x",
          accountId: "owner-account",
          webhookSecret: "test-secret",
          trustedHandles: ["alice"],
        },
      ],
    },
  };
}

describe("social module metadata", () => {
  it("has correct name, dependency, and version", () => {
    expect(socialModule.name).toBe("social");
    expect(socialModule.version).toBe("1.0.0");
    expect(socialModule.dependencies).toEqual(["inbound-signals"]);
  });
});

describe("social module inbound routes", () => {
  it("does not register routes without configured social connectors", () => {
    expect(socialModule.routes?.(makeCtx())).toEqual([]);
    expect(socialModule.routes?.(makeCtx({ inbound: {} }))).toEqual([]);
  });

  it("rejects configured connector deliveries with the wrong secret", async () => {
    const route = socialModule.routes?.(makeCtx(socialConfig()))?.[0];
    if (!route) throw new Error("expected social inbound route");
    const res = makeFakeResponse();

    await route.handler(
      makeFakeRequest("{}", { "x-kota-social-secret": "wrong" }),
      res as unknown as ServerResponse,
      { connectorId: "x-owner" },
    );

    expect(route.bypassAuth).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body!)).toEqual({
      error: "Invalid social connector secret",
    });
  });

  it("emits a typed inbound signal for a configured X mention connector", async () => {
    const bus = new EventBus();
    const emitted: Record<string, unknown>[] = [];
    bus.on(inboundSignalReceived, (payload) =>
      emitted.push(payload as Record<string, unknown>),
    );
    const ctx = makeCtx(socialConfig(), bus);
    const route = socialModule.routes?.(ctx)?.[0];
    if (!route) throw new Error("expected social inbound route");
    const res = makeFakeResponse();

    await route.handler(
      makeFakeRequest(
        JSON.stringify({
          delivery: {
            kind: "mention",
            id: "post-456",
            actor: {
              id: "actor-456",
              handle: "alice",
              displayName: "Alice Example",
            },
            text: "@kota capture this social signal",
            url: "https://x.com/alice/status/post-456",
            occurredAt: "2026-05-25T04:50:00.000Z",
          },
        }),
        { "x-kota-social-secret": "test-secret" },
      ),
      res as unknown as ServerResponse,
      { connectorId: "x-owner" },
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({
      ok: true,
      event: inboundSignalReceived.name,
      projectId: deriveDirectoryScopeId("/tmp/test"),
      provider: "x",
      channel: "x.mention",
      actorTrust: "trusted",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      projectId: deriveDirectoryScopeId("/tmp/test"),
      provider: "x",
      channel: "x.mention",
      accountId: "x:owner-account",
      sourceId: "x:owner-account:mention:post-456",
      actor: {
        id: "x:user:actor-456",
        trust: "trusted",
      },
      body: {
        kind: "action",
        action: "x.mention.received",
        data: {
          connectorId: "x-owner",
          text: "@kota capture this social signal",
          textTruncated: false,
        },
      },
    });
  });
});
