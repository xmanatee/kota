import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { createScopeScopedKotaClient } from "#core/server/project-scoped-kota-client.js";
import { memoryUiSurfaceSource } from "#modules/memory/ui-surface.js";
import daemonModule, { buildOperatorControlUiSurface } from "./index.js";

function projectionClient(): ModuleRuntimeContext["client"] {
  const client = {
    projects: {
      list: async () => ({
        ok: true as const,
        projects: [],
        defaultProjectId: "scope-default",
        activeProjectId: null,
      }),
    },
  } as unknown as ModuleRuntimeContext["client"];
  client.forProject = () => client;
  client.forScope = () => client;
  return client;
}

function stubContext(projectDir: string): ModuleRuntimeContext {
  return {
    cwd: projectDir,
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage(projectDir, "daemon"),
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
    events: { emit: () => {}, subscribe: () => () => {}, emitExternal: () => {}, subscribeExternal: () => () => {}, listenerCount: () => 0 },
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
    client: projectionClient(),
  };
}

describe("daemon-ops local UI client", () => {
  it("uses the module runtime's shared UI assembler", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-local-offline-"));
    try {
      const ctx = stubContext(projectDir);
      const getContributedUiSurfaces = vi.spyOn(ctx, "getContributedUiSurfaces");
      const local = daemonModule.localClient!(ctx);
      await expect(local.ui!.listSurfaces()).resolves.toEqual({
        protocolVersion: "ui.surface.v1",
        surfaces: [],
      });
      expect(getContributedUiSurfaces).toHaveBeenCalledOnce();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("executes local setup routes with the scope projected into the action", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-local-action-"));
    try {
      const baseContext = stubContext(projectDir);
      const baseStart = vi.fn(async () => ({
        ok: false as const,
        reason: "not_found" as const,
        message: "scope-z setup selected",
      }));
      const baseClient = {
        ...baseContext.client,
        setup: { start: baseStart },
      } as unknown as ModuleRuntimeContext["client"];
      const forScope = vi.fn((scopeId: string) =>
        createScopeScopedKotaClient(baseClient, scopeId)
      );
      baseClient.forScope = forScope;
      baseClient.forProject = () => baseClient;
      const ctx = { ...baseContext, client: baseClient };
      ctx.getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          project: () => [buildOperatorControlUiSurface("scope-z")],
        },
      }]);
      const local = daemonModule.localClient!(ctx);

      await expect(local.ui!.executeAction({
        surfaceId: "operator-control",
        actionId: "setup.oauth.start",
        scopeId: "scope-z",
      })).resolves.toEqual({
        ok: false,
        reason: "not_found",
        message: "scope-z setup selected",
      });
      expect(forScope).toHaveBeenCalledTimes(2);
      expect(forScope).toHaveBeenNthCalledWith(1, "scope-z");
      expect(forScope).toHaveBeenNthCalledWith(2, "scope-z");
      expect(baseStart).toHaveBeenCalledWith(
        "google-workspace",
        "oauth-credentials",
        { scopeId: "scope-z" },
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("executes daemon UI action requests through the same scoped local client", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-control-action-"));
    try {
      const baseContext = stubContext(projectDir);
      const baseStart = vi.fn(async () => ({
        ok: true as const,
        actionId: "setup-action-1",
        launchUrl: "https://example.test/setup",
      }));
      const baseClient = {
        ...baseContext.client,
        setup: { start: baseStart },
      } as unknown as ModuleRuntimeContext["client"];
      baseClient.forScope = (scopeId) => createScopeScopedKotaClient(baseClient, scopeId);
      baseClient.forProject = () => baseClient;
      const ctx = { ...baseContext, client: baseClient };
      ctx.getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          project: () => [buildOperatorControlUiSurface("scope-z")],
        },
      }]);
      const route = daemonModule.controlRoutes!(ctx).find((candidate) =>
        candidate.method === "POST" && candidate.path === "/ui/actions/execute"
      );
      if (!route) throw new Error("missing UI action execution route");
      const req = Readable.from([Buffer.from(JSON.stringify({
        surfaceId: "operator-control",
        actionId: "setup.oauth.start",
        scopeId: "scope-z",
      }))]);
      let statusCode = 0;
      let body = "";
      await route.handler(req as never, {
        setHeader: () => {},
        writeHead: (status: number) => {
          statusCode = status;
        },
        end: (chunk: string) => {
          body = chunk;
        },
      } as never, {});

      expect(statusCode).toBe(200);
      expect(JSON.parse(body)).toEqual({ ok: true, message: "Setup action started." });
      expect(baseStart).toHaveBeenCalledWith(
        "google-workspace",
        "oauth-credentials",
        { scopeId: "scope-z" },
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses the projected scope for local namespace action execution", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-local-namespace-"));
    try {
      const baseContext = stubContext(projectDir);
      const baseList = vi.fn(async () => ({ entries: [] }));
      const scopedList = vi.fn(async () => ({ entries: [] }));
      const baseClient = {
        ...baseContext.client,
        memory: { list: baseList },
      } as unknown as ModuleRuntimeContext["client"];
      const scopedClient = {
        ...baseClient,
        memory: { list: scopedList },
      } as unknown as ModuleRuntimeContext["client"];
      const forScope = vi.fn(() => scopedClient);
      baseClient.forScope = forScope;
      baseClient.forProject = () => scopedClient;
      scopedClient.forScope = () => scopedClient;
      scopedClient.forProject = () => scopedClient;
      const ctx = { ...baseContext, client: baseClient };
      ctx.getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "memory",
        source: memoryUiSurfaceSource,
      }]);
      const local = daemonModule.localClient!(ctx);

      await expect(local.ui!.executeAction({
        surfaceId: "stores",
        actionId: "memory.list",
        scopeId: "scope-b",
      })).resolves.toEqual({
        ok: true,
        message: "0 memory entries loaded.",
      });
      expect(forScope).toHaveBeenCalledTimes(2);
      expect(scopedList).toHaveBeenCalledTimes(2);
      expect(baseList).not.toHaveBeenCalled();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
