/**
 * Modules namespace daemon-side handler test.
 *
 * The modules namespace migrated out of `buildCoreStubDaemonClientHandlers`
 * into `daemonClient(link)` on the module-manager module. This test pins
 * the invariants the migration relies on:
 *
 *  1. The module-manager module exposes a `daemonClient(link)` factory and
 *     the factory returns a handler for the `modules` namespace.
 *  2. `list()` is wired through `requestStrict<T>` — calling `list` issues
 *     a single `GET /modules` with no query string and no body.
 *  3. A successful response decodes verbatim as
 *     `{ modules: ModuleListEntry[] }`.
 *  4. `requestStrict<T>` failures propagate through `list` rather than being
 *     silently swallowed — the silent-`null` fallback the previous
 *     `listModulesHttp` carried is gone.
 *  5. Removing the module-manager module's daemonClient contribution makes
 *     the assembled client fail loudly with a clear "modules" missing-
 *     handler error.
 *  6. Supplying the contribution to the assembly path satisfies coverage.
 */

import { describe, expect, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  ModuleInspectEntry,
  ModuleInspectResult,
  ModuleListEntry,
  ModulesListResult,
} from "./client.js";
import moduleManagerModule from "./index.js";

type RecordedRequestStrict = {
  kind: "requestStrict";
  method: string;
  path: string;
  body: unknown;
};

function makeRecordingTransport(options: {
  requestStrictResponder?: (
    method: string,
    path: string,
    body: unknown,
  ) => unknown;
}): { transport: DaemonTransport; calls: RecordedRequestStrict[] } {
  const calls: RecordedRequestStrict[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ kind: "requestStrict", method, path, body });
      if (!options.requestStrictResponder) {
        throw new Error("unexpected requestStrict call");
      }
      return options.requestStrictResponder(method, path, body) as T;
    },
    fetchRaw: async (): Promise<Response> => {
      throw new Error("unexpected fetchRaw call");
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function makeEntry(name: string): ModuleListEntry {
  return {
    name,
    source: "project",
    status: "loaded",
    toolCount: 0,
    workflowCount: 0,
    commandCount: 0,
    channelCount: 0,
    skillCount: 0,
    agentCount: 0,
  };
}

describe("module-manager module daemonClient(link)", () => {
  it("contributes a modules namespace handler", () => {
    expect(moduleManagerModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = moduleManagerModule.daemonClient!(transport);
    expect(contributed.modules).toBeDefined();
    expect(typeof contributed.modules!.list).toBe("function");
  });

  it("routes list through GET /modules with no body", async () => {
    const expected: ModulesListResult = { modules: [] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modules!.list();
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/modules",
        body: undefined,
      },
    ]);
  });

  it("decodes the wire response verbatim into { modules: ModuleListEntry[] }", async () => {
    const entries: ModuleListEntry[] = [
      makeEntry("module-manager"),
      { ...makeEntry("doctor"), version: "1.0.0", description: "health" },
    ];
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => ({ modules: entries }),
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modules!.list();
    expect(result).toEqual({ modules: entries });
  });

  it("propagates list HTTP failures rather than silently returning an empty list", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    await expect(contributed.modules!.list()).rejects.toThrow(/boom/);
  });

  it("the assembly path fails loudly when the module-manager module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.modules;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /modules/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the module-manager module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = moduleManagerModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.modules;
    delete others.modulesAdmin;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});

function makeInspectEntry(name: string): ModuleInspectEntry {
  return {
    name,
    source: "project",
    status: "loaded",
    dependencies: [],
    toolNames: [],
    workflowNames: [],
    commandNames: [],
    routeSummaries: [],
    channelNames: [],
    skillNames: [],
    agentNames: [],
  };
}

describe("module-manager module daemonClient(link) — modulesAdmin", () => {
  it("contributes a modulesAdmin namespace handler with both methods", () => {
    expect(moduleManagerModule.daemonClient).toBeTypeOf("function");
    const { transport } = makeRecordingTransport({});
    const contributed = moduleManagerModule.daemonClient!(transport);
    expect(contributed.modulesAdmin).toBeDefined();
    expect(typeof contributed.modulesAdmin!.inspect).toBe("function");
    expect(typeof contributed.modulesAdmin!.reload).toBe("function");
  });

  it("routes inspect through GET /modules/{encodeURIComponent(name)} with no body", async () => {
    const entry = makeInspectEntry("module-manager");
    const expected: ModuleInspectResult = { found: true, module: entry };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.inspect("module-manager");
    expect(result).toEqual(expected);
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/modules/module-manager",
        body: undefined,
      },
    ]);
  });

  it("URL-encodes the name segment when inspect is called with a special-character name", async () => {
    const expected: ModuleInspectResult = { found: false };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    await contributed.modulesAdmin!.inspect("name with/slash");
    expect(calls).toEqual([
      {
        kind: "requestStrict",
        method: "GET",
        path: "/modules/name%20with%2Fslash",
        body: undefined,
      },
    ]);
  });

  it("decodes a successful { found: true; module } response verbatim", async () => {
    const entry: ModuleInspectEntry = {
      ...makeInspectEntry("doctor"),
      version: "1.0.0",
      description: "health checks",
      toolNames: ["check"],
      health: { status: "healthy", restartCount: 0 },
    };
    const expected: ModuleInspectResult = { found: true, module: entry };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.inspect("doctor");
    expect(result).toEqual(expected);
  });

  it("decodes a { found: false } response verbatim", async () => {
    const expected: ModuleInspectResult = { found: false };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => expected,
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.inspect("missing");
    expect(result).toEqual(expected);
  });

  it("propagates inspect transport failures rather than masquerading as { found: false }", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: () => {
        throw new Error("boom");
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    await expect(contributed.modulesAdmin!.inspect("any")).rejects.toThrow(
      /boom/,
    );
  });

  it("routes reload through POST /reload then GET /modules and assembles ok=true when the name is present and changed", async () => {
    const moduleListEntry: ModuleListEntry = {
      name: "doctor",
      source: "project",
      status: "loaded",
      toolCount: 0,
      workflowCount: 0,
      commandCount: 0,
      channelCount: 0,
      skillCount: 0,
      agentCount: 0,
    };
    const reloadResponse = {
      ok: true,
      workflows: 7,
      changedModules: ["doctor"],
    };
    const listResponse: ModulesListResult = { modules: [moduleListEntry] };
    const { transport, calls } = makeRecordingTransport({
      requestStrictResponder: (method, path) => {
        if (method === "POST" && path === "/reload") return reloadResponse;
        if (method === "GET" && path === "/modules") return listResponse;
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.reload("doctor");
    expect(result).toEqual({ ok: true, reloaded: true, workflowsActive: 7 });
    expect(calls).toEqual([
      { kind: "requestStrict", method: "POST", path: "/reload", body: undefined },
      { kind: "requestStrict", method: "GET", path: "/modules", body: undefined },
    ]);
  });

  it("assembles ok=true with reloaded=false when the name is present but unchanged", async () => {
    const reloadResponse = { ok: true, workflows: 4, changedModules: [] };
    const listResponse: ModulesListResult = {
      modules: [
        {
          name: "doctor",
          source: "project",
          status: "loaded",
          toolCount: 0,
          workflowCount: 0,
          commandCount: 0,
          channelCount: 0,
          skillCount: 0,
          agentCount: 0,
        },
      ],
    };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: (method, path) => {
        if (method === "POST" && path === "/reload") return reloadResponse;
        if (method === "GET" && path === "/modules") return listResponse;
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.reload("doctor");
    expect(result).toEqual({ ok: true, reloaded: false, workflowsActive: 4 });
  });

  it("assembles { ok: false, reason: 'not_found' } when the name is absent from the modules list", async () => {
    const reloadResponse = {
      ok: true,
      workflows: 4,
      changedModules: ["other"],
    };
    const listResponse: ModulesListResult = { modules: [] };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: (method, path) => {
        if (method === "POST" && path === "/reload") return reloadResponse;
        if (method === "GET" && path === "/modules") return listResponse;
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    const result = await contributed.modulesAdmin!.reload("missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("propagates a /reload transport failure rather than silently swallowing it", async () => {
    const { transport } = makeRecordingTransport({
      requestStrictResponder: (method, path) => {
        if (method === "POST" && path === "/reload") {
          throw new Error("reload-down");
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    await expect(contributed.modulesAdmin!.reload("doctor")).rejects.toThrow(
      /reload-down/,
    );
  });

  it("propagates a /modules existence-check transport failure rather than silently swallowing it", async () => {
    const reloadResponse = {
      ok: true,
      workflows: 4,
      changedModules: ["doctor"],
    };
    const { transport } = makeRecordingTransport({
      requestStrictResponder: (method, path) => {
        if (method === "POST" && path === "/reload") return reloadResponse;
        if (method === "GET" && path === "/modules") {
          throw new Error("list-down");
        }
        throw new Error(`unexpected ${method} ${path}`);
      },
    });
    const contributed = moduleManagerModule.daemonClient!(transport);
    await expect(contributed.modulesAdmin!.reload("doctor")).rejects.toThrow(
      /list-down/,
    );
  });

  it("the assembly path fails loudly when the modulesAdmin contribution is removed", () => {
    const { transport } = makeRecordingTransport({});
    const others = buildMigratedNamespaceTestStubs();
    delete others.modulesAdmin;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /modulesAdmin/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });

  it("supplying the modulesAdmin contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport({});
    const contributed = moduleManagerModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.modules;
    delete others.modulesAdmin;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });
});
