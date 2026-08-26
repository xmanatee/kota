import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import daemonModule, { buildOperatorControlUiSurface } from "./index.js";

function migratedClient(): ModuleRuntimeContext["client"] {
  return createKotaClientTestDouble();
}

const stubCtx: ModuleRuntimeContext = {
  cwd: "/tmp",
  verbose: false,
  config: {} as ModuleRuntimeContext["config"],
  storage: new ModuleStorage("/tmp/test", "daemon"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getContributedUiSurfaces: () => [],
  getContributedControlRoutes: () => [],
  getModuleSummaries: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: {
    emit: () => {},
    subscribe: () => () => {},
    emitExternal: () => {},
    subscribeExternal: () => () => {},
    listenerCount: () => 0,
  },
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

describe("daemonModule definition", () => {
  it("registers its metadata, dependencies, and operator commands", () => {
    expect(daemonModule.name).toBe("daemon-ops");
    expect(daemonModule.version).toBe("1.0.0");
    expect(daemonModule.description).toContain("daemon runtime");
    expect(daemonModule.dependencies).toEqual(
      expect.arrayContaining(["repo-tasks", "rendering"]),
    );

    const commands = daemonModule.commands!(stubCtx);
    expect(commands.map((command) => command.name())).toEqual([
      "daemon",
      "events",
      "session",
      "status",
      "inbox",
      "ui",
      "scope",
    ]);
    const daemon = commands[0];
    expect(daemon.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--verbose", "--poll-interval", "--log-format"]),
    );
    const start = daemon.commands.find((command) => command.name() === "start")!;
    expect(start.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        "--verbose",
        "--preset",
        "--poll-interval",
        "--scope-root",
        "--log-format",
      ]),
    );
    const preset = start.options.find((option) => option.long === "--preset");
    expect(preset?.description).toContain("openrouter-lab");
    expect(preset?.description).toContain("KOTA_PRESET");
    expect(preset?.description).toContain("config.defaultPreset");
    const install = daemon.commands.find((command) => command.name() === "install")!;
    expect(install.options.map((option) => option.long)).toContain("--dry-run");
    expect(daemonModule.tools).toBeUndefined();
    expect(daemonModule.routes).toBeUndefined();
    expect(
      typeof daemonModule.uiSurfaces === "function"
        ? []
        : daemonModule.uiSurfaces?.map((source) => source.sourceId),
    ).toEqual(["status", "scopes", "inbox", "continuity"]);
  });

  it("serves the unified scoped module projection from /ui/surfaces", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-route-"));
    try {
      const getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          scope: ({ scopeId }: { scopeId: string }) => [
            buildOperatorControlUiSurface(scopeId),
          ],
        },
      }]);
      const ctx: ModuleRuntimeContext = {
        ...stubCtx,
        cwd: scopeRoot,
        client: migratedClient(),
        storage: new ModuleStorage(scopeRoot, "daemon"),
        getContributedUiSurfaces,
      };
      const route = daemonModule.controlRoutes!(ctx).find((candidate) =>
        candidate.method === "GET" && candidate.path === "/ui/surfaces"
      );
      if (!route) throw new Error("missing /ui/surfaces route");

      let statusCode = 0;
      let body = "";
      const res = {
        setHeader: () => {},
        writeHead: (code: number) => {
          statusCode = code;
        },
        end: (chunk: string) => {
          body = chunk;
        },
      };
      await route.handler(
        { url: "/ui/surfaces?scopeId=scope-b" } as never,
        res as never,
        {},
      );
      expect(statusCode).toBe(200);
      const parsed = JSON.parse(body) as {
        surfaces: Array<{ surfaceId: string; scopeId: string }>;
      };
      expect(parsed.surfaces).toEqual([
        expect.objectContaining({ surfaceId: "operator-control", scopeId: "scope-b" }),
      ]);
      expect(getContributedUiSurfaces).toHaveBeenCalledOnce();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("uses the daemon's implicit active scope for contributor reads", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-route-active-"));
    try {
      const migrated = migratedClient();
      const baseMemoryList = vi.fn(async () => ({
        entries: [{ id: "base", content: "base", created: "2026-07-31T00:00:00.000Z" }],
      }));
      const scopedMemoryList = vi.fn(async () => ({
        entries: [{ id: "scoped", content: "scoped", created: "2026-07-31T00:00:00.000Z" }],
      }));
      let scopedClient: ModuleRuntimeContext["client"];
      const forScope = vi.fn(() => scopedClient);
      const baseClient = {
        ...migrated,
        memory: { ...migrated.memory, list: baseMemoryList },
        forScope,
      } satisfies ModuleRuntimeContext["client"];
      scopedClient = {
        ...baseClient,
        memory: { ...baseClient.memory, list: scopedMemoryList },
        forScope: () => scopedClient,
      } satisfies ModuleRuntimeContext["client"];
      const getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          scope: async ({
            client,
            scopeId,
          }: {
            client: ModuleRuntimeContext["client"];
            scopeId: string;
          }) => {
            const memory = await client.memory.list();
            return [{
              ...buildOperatorControlUiSurface(scopeId),
              title: memory.entries[0]?.content ?? "missing",
            }];
          },
        },
      }]);
      const scopeProvider = {
        getScopeRegistryProjection: () => ({
          defaultScopeId: "scope-default",
          scopes: [],
        }),
        getActiveScopeId: () => "scope-active",
        resolveScopeRuntime: () => {
          throw new Error("not used");
        },
      };
      const ctx: ModuleRuntimeContext = {
        ...stubCtx,
        cwd: scopeRoot,
        client: baseClient,
        storage: new ModuleStorage(scopeRoot, "daemon"),
        getContributedUiSurfaces,
        getProvider: vi.fn((token) =>
          token === DAEMON_SCOPE_PROVIDER_TYPE ? scopeProvider : null
        ) as ModuleRuntimeContext["getProvider"],
      };
      const route = daemonModule.controlRoutes!(ctx).find((candidate) =>
        candidate.method === "GET" && candidate.path === "/ui/surfaces"
      );
      if (!route) throw new Error("missing /ui/surfaces route");

      let statusCode = 0;
      let body = "";
      const res = {
        setHeader: () => {},
        writeHead: (code: number) => {
          statusCode = code;
        },
        end: (chunk: string) => {
          body = chunk;
        },
      };
      await route.handler(
        { url: "/ui/surfaces" } as never,
        res as never,
        {},
      );

      expect(statusCode).toBe(200);
      const parsed = JSON.parse(body) as {
        surfaces: Array<{ scopeId: string; title: string }>;
      };
      expect(parsed.surfaces).toEqual([
        expect.objectContaining({ scopeId: "scope-active", title: "scoped" }),
      ]);
      expect(forScope).toHaveBeenCalledOnce();
      expect(forScope).toHaveBeenCalledWith("scope-active");
      expect(scopedMemoryList).toHaveBeenCalledOnce();
      expect(baseMemoryList).not.toHaveBeenCalled();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
