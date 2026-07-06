import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import daemonModule from "./index.js";

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
    client: {} as never,
  };
}

describe("daemon-ops local UI client", () => {
  it("returns an empty shared UI bundle when the daemon is offline", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-ui-local-offline-"));
    try {
      const local = daemonModule.localClient!(stubContext(projectDir));
      await expect(local.ui!.listSurfaces()).resolves.toEqual({
        protocolVersion: "ui.surface.v1",
        surfaces: [],
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
