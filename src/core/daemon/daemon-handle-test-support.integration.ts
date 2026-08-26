import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import {
  resolveScopePolicy,
  type ScopePolicyAuthority,
} from "./scope-policy.js";
import { GLOBAL_SCOPE_ID, type ScopeRegistry } from "./scope-registry.js";
import type { ScopeRuntime, ScopeRuntimeRegistry } from "./scope-runtime.js";

export type ReloadSubject = {
  handle: ReturnType<typeof buildDaemonHandle>;
  events: BusEvents["daemon.config.reload"][];
  restartRequests: BusEvents["runtime.restart_requested"][];
  refreshLiveSessionGuardrails: ReturnType<typeof vi.fn>;
  workflowRuntime: {
    setWorkflowInputs: ReturnType<typeof vi.fn>;
    reloadWorkflowDefinitions: ReturnType<typeof vi.fn>;
    getDefinitionCount: ReturnType<typeof vi.fn>;
  };
};

function makeTestScopePolicyAuthority(scopeRoot: string): ScopePolicyAuthority {
  const policy = resolveScopePolicy({
    projection: {
      rootScopeId: GLOBAL_SCOPE_ID,
      defaultScopeId: "test-scope",
      scopes: [
        { scopeId: GLOBAL_SCOPE_ID, displayName: "Global" },
        {
          scopeId: "test-scope",
          displayName: "Test project",
          parentScopeId: GLOBAL_SCOPE_ID,
          directoryRoot: scopeRoot,
        },
      ],
    },
    scopeId: "test-scope",
  });
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}

export function makeReloadSubject(
  initialConfig: KotaConfig = {},
  getModuleSummaries: () => readonly ModuleSummary[] = () => [],
): ReloadSubject {
  const bus = new EventBus();
  const events: BusEvents["daemon.config.reload"][] = [];
  const restartRequests: BusEvents["runtime.restart_requested"][] = [];
  bus.on("daemon.config.reload", (payload) => {
    events.push(payload);
  });
  bus.on("runtime.restart_requested", (payload) => {
    restartRequests.push(payload);
  });

  const workflowRuntime = {
    setWorkflowInputs: vi.fn(),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 5 })),
    getDefinitionCount: vi.fn(() => 3),
  };
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-handle-test-"));
  const pbus = new ScopedEventBus(bus, "test-scope");
  const runtime = {
    scope: {
      scopeId: "test-scope",
      scopeRoot,
      displayName: "Test project",
    },
    workflowRuntime,
    pbus,
    scopePolicyAuthority: makeTestScopePolicyAuthority(scopeRoot),
  } as unknown as ScopeRuntime;
  const scopeRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ScopeRuntimeRegistry;
  const scopeRegistry = {
    get: vi.fn(),
    getDefaultScopeId: vi.fn(() => "test-scope"),
    toProjection: vi.fn(() => ({ defaultScopeId: "test-scope", scopes: [] })),
  } as unknown as ScopeRegistry;
  const refreshLiveSessionGuardrails = vi.fn(() => ({
    refreshed: 0,
    unchanged: 0,
  }));

  const handle = buildDaemonHandle({
    getState: () => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      pid: 1234,
    }),
    isRunning: () => true,
    workflows: workflowRuntime as unknown as WorkflowRuntime,
    bus,
    sessions: new Map(),
    runStore: {} as WorkflowRunStore,
    scopeRoot,
    scopeRegistry,
    scopeRuntimes,
    getScopeHostingState: () => "hosted",
    config: { config: initialConfig, verbose: false },
    refreshLiveSessionGuardrails,
    log: () => {},
    getModuleSummaries,
    getModuleHealthChecks: () => ({}),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getChannelStatuses: () => [],
  });

  return {
    handle,
    events,
    restartRequests,
    refreshLiveSessionGuardrails,
    workflowRuntime,
  };
}

export function mockModuleMetadata(): void {
  vi.mocked(loadModuleMetadata).mockResolvedValue({
    getModuleSummaries: () => [
      { name: "git", dependencies: [] },
      { name: "github", dependencies: ["git"] },
      { name: "filesystem", dependencies: [] },
    ],
    getContributedSetupRequirements: () => [],
    getContributedWorkflows: () => [{ name: "builder", triggers: [], steps: [] }],
  } as unknown as Awaited<ReturnType<typeof loadModuleMetadata>>);
}

export function makeWorkflowRunSubject(
  metadata: WorkflowRunMetadata,
): ReturnType<typeof buildDaemonHandle> {
  const bus = new EventBus();
  const runStore = {
    getRun: vi.fn((id: string) => (id === metadata.id ? metadata : null)),
  };
  const runtime = {
    scope: {
      scopeId: "test-scope",
      scopeRoot: mkdtempSync(join(tmpdir(), "kota-daemon-run-test-")),
    },
    runStore,
    workflowRuntime: {
      getDefinitionCount: vi.fn(() => 0),
    },
  } as unknown as ScopeRuntime;
  const scopeRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ScopeRuntimeRegistry;
  const scopeRegistry = {
    get: vi.fn(),
    getDefaultScopeId: vi.fn(() => "test-scope"),
    toProjection: vi.fn(() => ({ defaultScopeId: "test-scope", scopes: [] })),
  } as unknown as ScopeRegistry;

  return buildDaemonHandle({
    getState: () => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      pid: 1234,
    }),
    isRunning: () => true,
    workflows: runtime.workflowRuntime,
    bus,
    sessions: new Map(),
    runStore: runStore as unknown as WorkflowRunStore,
    scopeRoot: runtime.scope.scopeRoot,
    scopeRegistry,
    scopeRuntimes,
    getScopeHostingState: () => "hosted",
    config: { config: {}, verbose: false },
    refreshLiveSessionGuardrails: () => ({ refreshed: 0, unchanged: 0 }),
    log: () => {},
    getModuleSummaries: () => [],
    getModuleHealthChecks: () => ({}),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getChannelStatuses: () => [],
  });
}
