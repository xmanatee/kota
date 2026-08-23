import { vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { SlackChannelConfig } from "./config.js";

export const STUB_CHANNEL_START_CTX = {
  getDefaultProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
    }) as never,
  getProjectRuntime: () =>
    ({
      project: { projectId: "test-project", projectDir: "/tmp", displayName: "test" },
    }) as never,
  log: () => {},
  reportFailure: () => {},
  getWorkflowStatus: () => ({
    runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
    dispatchPaused: false,
    runsDir: "/tmp/.kota/runs",
  }),
};

export function makeSlackChannelModuleTestContext(
  bus?: EventBus,
  moduleConfig?: Partial<SlackChannelConfig>,
  kotaConfig?: ModuleRuntimeContext["config"],
): ModuleRuntimeContext {
  const eventBus = bus ?? new EventBus();
  return {
    cwd: "/tmp",
    verbose: false,
    config: kotaConfig ?? ({ serve: { defaultAutonomyMode: "supervised" } } as ModuleRuntimeContext["config"]),
    storage: new ModuleStorage("/tmp/test", "slack-channel"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => moduleConfig as never,
    log: Object.assign(() => {}, {
      info: () => {},
      warn: vi.fn(),
      error: () => {},
      debug: () => {},
    }),
    getSecret: vi.fn(() => null),
    listTools: () => [],
    events: makeStubEventProxy(eventBus),
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
    client: {
      recall: {},
      answer: {},
      capture: {},
      memory: {},
      knowledge: {},
      history: {},
      tasks: {},
      approvals: {
        list: vi.fn(async () => ({
          approvals: [{
            id: "abc123",
            scopeId: "test-project",
            tool: "shell",
            input: { redacted: true, reason: "tool-io" },
            review: {
              status: "available",
              input: { command: "deploy --target /srv/app" },
              context: "user: deploy the client release",
              digest: "a".repeat(64),
            },
            risk: "dangerous",
            reason: "Runs commands",
            createdAt: "2026-07-28T22:00:00.000Z",
            status: "pending",
          }],
        })),
        approve: vi.fn(),
        reject: vi.fn(),
      },
    } as never,
  };
}
