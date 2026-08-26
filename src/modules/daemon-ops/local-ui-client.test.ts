import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { createScopedKotaClient } from "#core/server/scoped-kota-client.js";
import { memoryUiSurfaceSource } from "#modules/memory/ui-surface.js";
import daemonModule, { buildOperatorControlUiSurface } from "./index.js";

function projectionClient(): ModuleRuntimeContext["client"] {
  const client = {
    scopes: {
      list: async () => ({
        ok: true as const,
        scopes: [],
        defaultScopeId: "scope-default",
        activeScopeId: null,
      }),
    },
  } as unknown as ModuleRuntimeContext["client"];
  client.forScope = () => client;
  return client;
}

function stubContext(scopeRoot: string): ModuleRuntimeContext {
  return {
    cwd: scopeRoot,
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage(scopeRoot, "daemon"),
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
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-local-offline-"));
    try {
      const ctx = stubContext(scopeRoot);
      const getContributedUiSurfaces = vi.spyOn(ctx, "getContributedUiSurfaces");
      const local = daemonModule.localClient!(ctx);
      await expect(local.ui!.listSurfaces()).resolves.toEqual({
        protocolVersion: "ui.surface.v1",
        surfaces: [],
      });
      expect(getContributedUiSurfaces).toHaveBeenCalledOnce();
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("executes local setup routes with the scope projected into the action", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-local-action-"));
    try {
      const baseContext = stubContext(scopeRoot);
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
        createScopedKotaClient(baseClient, scopeId)
      );
      baseClient.forScope = forScope;
      const ctx = { ...baseContext, client: baseClient };
      ctx.getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          scope: () => [buildOperatorControlUiSurface("scope-z")],
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
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("executes daemon UI action requests through the same scoped local client", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-control-action-"));
    try {
      const baseContext = stubContext(scopeRoot);
      const baseStart = vi.fn(async () => ({
        ok: true as const,
        action: {
          actionId: "setup-action-1",
          moduleName: "google-workspace",
          requirementId: "oauth-credentials",
          url: "https://example.test/setup",
          label: "Open setup",
          status: "pending" as const,
          createdAt: "2026-08-26T00:00:00.000Z",
          expiresAt: "2026-08-26T00:10:00.000Z",
        },
        status: {} as never,
      }));
      const baseClient = {
        ...baseContext.client,
        setup: { start: baseStart },
      } as unknown as ModuleRuntimeContext["client"];
      baseClient.forScope = (scopeId) => createScopedKotaClient(baseClient, scopeId);
      const ctx = { ...baseContext, client: baseClient };
      ctx.getContributedUiSurfaces = vi.fn(() => [{
        moduleName: "test-ui",
        source: {
          sourceId: "operator-control",
          scope: () => [buildOperatorControlUiSurface("scope-z")],
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
      expect(JSON.parse(body)).toEqual({
        ok: true,
        message: "Setup action started.",
        payload: {
          kind: "external-url",
          url: "https://example.test/setup",
          label: "Open setup",
        },
      });
      expect(baseStart).toHaveBeenCalledWith(
        "google-workspace",
        "oauth-credentials",
        { scopeId: "scope-z" },
      );
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("uses the projected scope for local namespace action execution", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-local-namespace-"));
    try {
      const baseContext = stubContext(scopeRoot);
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
      scopedClient.forScope = () => scopedClient;
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
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
