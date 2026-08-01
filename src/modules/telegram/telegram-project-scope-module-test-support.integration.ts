import { vi } from "vitest";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getProviderRegistry,
  initProviderRegistry,
} from "#core/modules/provider-registry.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { callTelegramApi } from "./client.js";
import {
  PROJECT_A,
  PROJECT_B,
} from "./telegram-project-scope-daemon-test-support.integration.js";

export function registerDaemonProjectScopeProvider(
  projects: ConfiguredProject[] = [PROJECT_A, PROJECT_B],
  defaultProject: ConfiguredProject = PROJECT_A,
): void {
  const registry = getProviderRegistry() ?? initProviderRegistry();
  registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "test", {
    getProjectRegistryProjection: () => ({
      defaultProjectId: defaultProject.projectId,
      projects,
    }),
    getActiveProjectId: () => null,
    resolveProjectRuntime: (projectId) => {
      const requested = projectId?.trim();
      const resolvedProjectId =
        requested && requested.length > 0
          ? requested
          : defaultProject.projectId;
      const project = projects.find(
        (entry) => entry.projectId === resolvedProjectId,
      );
      if (!project) {
        return {
          ok: false,
          error: {
            error: "Unknown project",
            reason: "unknown_project",
            projectId: resolvedProjectId,
          },
        };
      }
      return {
        ok: true,
        runtime: {
          project,
          approvalQueue: {} as never,
          secretStore: {} as never,
          ownerDecisionStore: {} as never,
          ownerQuestionQueue: {} as never,
        },
      };
    },
  });
}

export function makeUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: { chat: { id: 99 }, text },
  };
}

export function sendBodies(): Array<{
  chat_id: string | number;
  text: string;
}> {
  return vi.mocked(callTelegramApi).mock.calls
    .filter((call) => call[1] === "sendMessage")
    .map((call) => call[2] as { chat_id: string | number; text: string });
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

export function makeCtx(
  bus: EventBus,
  client: KotaClient,
  storage: ModuleStorage,
): ModuleRuntimeContext {
  return {
    cwd: PROJECT_A.projectDir,
    verbose: false,
    config: {
      model: "claude-sonnet-4-6",
      modelProvider: { type: "anthropic", apiKey: "sk-test" },
    } as ModuleRuntimeContext["config"],
    storage,
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => undefined,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    getSecret: (key) => process.env[key] ?? null,
    listTools: () => [],
    events: makeStubEventProxy(bus),
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: (token) => getProviderRegistry()?.get(token) ?? null,
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
    client,
  };
}
