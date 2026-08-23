import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "./health-signal.js";

export const ISSUE_SOURCE_SCOPE_ID = "scope-fixture";

function makeContext(
  projectDir: string,
  bus: EventBus,
): ModuleRuntimeContext {
  return {
    cwd: projectDir,
    verbose: false,
    config: {} as ModuleRuntimeContext["config"],
    storage: new ModuleStorage(projectDir, "autonomy"),
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

export function wireAutonomyIssueSourceFixture(projectDir: string): {
  pbus: ProjectScopedEventBus;
  signals: AutonomyHealthSignal[];
} {
  const bus = new EventBus();
  const pbus = new ProjectScopedEventBus(bus, ISSUE_SOURCE_SCOPE_ID);
  const signals: AutonomyHealthSignal[] = [];
  bus.on(autonomyHealthSignal, (payload) => signals.push(payload));
  subscribeAutonomyIssueSources(makeContext(projectDir, bus));
  return { pbus, signals };
}
