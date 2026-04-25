import { EventEmitter } from "node:events";
import type { IncomingMessage, OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import vercelAdapterModule from "./index.js";

function makeContext(config: KotaConfig = { model: "test-model" } as KotaConfig): ModuleContext {
  return {
    cwd: "/tmp",
    verbose: false,
    config,
    storage: new ModuleStorage("/tmp", "vercel-adapter"),
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
    events: { emit: () => {}, subscribe: () => () => {}, listenerCount: () => 0 },
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

function makeRequest(body: unknown): IncomingMessage {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    headers: {},
    method: "POST",
    url: "/api/chat/vercel",
    destroy: () => {},
  }) as unknown as IncomingMessage;
  setImmediate(() => {
    emitter.emit("data", Buffer.from(JSON.stringify(body)));
    emitter.emit("end");
  });
  return req;
}

function makeResponse(): ServerResponse & { statusCodeSeen?: number; body: string; headersSeen: Record<string, string> } {
  const res = new EventEmitter() as ServerResponse & {
    statusCodeSeen?: number;
    body: string;
    headersSeen: Record<string, string>;
  };
  res.body = "";
  res.headersSeen = {};
  res.setHeader = (key: string, value: number | string | readonly string[]) => {
    res.headersSeen[key] = Array.isArray(value) ? value.join(", ") : String(value);
    return res;
  };
  const recordHeaders = (headers?: OutgoingHttpHeaders | OutgoingHttpHeader[]) => {
    if (!headers || Array.isArray(headers)) return;
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) res.headersSeen[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  };
  res.writeHead = ((
    statusCode: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ) => {
    res.statusCodeSeen = statusCode;
    recordHeaders(typeof statusMessageOrHeaders === "string" ? headers : statusMessageOrHeaders);
    return res;
  }) as typeof res.writeHead;
  res.write = ((chunk: unknown) => {
    if (chunk) res.body += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    return true;
  }) as typeof res.write;
  res.end = ((chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) => {
    if (chunk) res.body += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    if (typeof encodingOrCallback === "function") encodingOrCallback();
    if (callback) callback();
    return res;
  }) as typeof res.end;
  return res;
}

describe("vercel-adapter module", () => {
  it("has correct metadata", () => {
    expect(vercelAdapterModule.name).toBe("vercel-adapter");
    expect(vercelAdapterModule.version).toBe("1.0.0");
    expect(vercelAdapterModule.description).toBeTruthy();
  });

  it("has no tools or commands", () => {
    expect(vercelAdapterModule.tools).toBeUndefined();
    expect(vercelAdapterModule.commands).toBeUndefined();
  });

  it("registers routes", () => {
    expect(vercelAdapterModule.routes).toBeTypeOf("function");
  });

  it("registers POST /api/chat/vercel route", () => {
    const ctx = makeContext();
    const routes = vercelAdapterModule.routes!(ctx);
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("POST");
    expect(routes[0].path).toBe("/api/chat/vercel");
    expect(routes[0].handler).toBeTypeOf("function");
  });

  it("returns a request error before opening the stream when autonomy is not configured", async () => {
    const route = vercelAdapterModule.routes!(makeContext())[0];
    const req = makeRequest({
      messages: [{ role: "user", content: "hello" }],
    });
    const res = makeResponse();

    await route.handler(req, res);

    expect(res.statusCodeSeen).toBe(400);
    expect(JSON.parse(res.body).error).toContain("autonomy mode is not configured");
    expect(res.headersSeen["x-vercel-ai-data-stream"]).toBeUndefined();
  });
});
