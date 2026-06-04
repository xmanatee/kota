import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import { eventTriggerRoutes } from "./event-trigger-routes.js";

function makeStubCtx(bus: EventBus): ModuleRuntimeContext {
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage("/tmp/test", "webhook"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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

async function invokeRoute(
  body: string,
  eventName = inboundSignalReceived.name,
): Promise<{ response: FakeResponse; emitted: Record<string, unknown>[] }> {
  const bus = new EventBus();
  const emitted: Record<string, unknown>[] = [];
  bus.on(inboundSignalReceived, (payload) =>
    emitted.push(payload as Record<string, unknown>),
  );
  const route = eventTriggerRoutes(makeStubCtx(bus))[0];
  const res = makeFakeResponse();
  await route.handler(
    makeFakeRequest(body),
    res as unknown as ServerResponse,
    { name: eventName },
  );
  return { response: res, emitted };
}

describe("eventTriggerRoutes inbound signal path", () => {
  it("validates and emits known inbound-signal payloads through the typed event", async () => {
    const { response, emitted } = await invokeRoute(
      JSON.stringify({
        provider: "webhook",
        channel: "http",
        accountId: "manual",
        sourceId: "curl/demo",
        sourceUrl: "https://example.test/signals/demo",
        externalId: "delivery-1",
        occurredAt: "2026-05-25T02:42:00.000Z",
        actor: {
          id: "owner@example.test",
          displayName: "Owner",
          trust: "trusted",
          trustReason: "authenticated daemon API token",
        },
        body: {
          kind: "message",
          format: "plain",
          text: "Capture this into a bounded workflow.",
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toMatchObject({
      ok: true,
      event: inboundSignalReceived.name,
      projectId: deriveDirectoryScopeId("/tmp/test"),
      actorTrust: "trusted",
      listeners: 1,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      projectId: deriveDirectoryScopeId("/tmp/test"),
      provider: "webhook",
      channel: "http",
      actor: { trust: "trusted" },
      body: { kind: "message", text: "Capture this into a bounded workflow." },
    });
  });

  it("rejects malformed inbound-signal payloads instead of emitting raw external events", async () => {
    const { response, emitted } = await invokeRoute(
      JSON.stringify({
        provider: "webhook",
        channel: "http",
        accountId: "manual",
        sourceId: "curl/demo",
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body!)).toMatchObject({
      error: "actor must be an object",
    });
    expect(emitted).toEqual([]);
  });

  it("keeps non-contract dynamic events on the external escape hatch", async () => {
    const { response, emitted } = await invokeRoute(
      JSON.stringify({ ok: true }),
      "vendor.dynamic",
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body!)).toMatchObject({
      ok: true,
      event: "vendor.dynamic",
    });
    expect(emitted).toEqual([]);
  });
});
