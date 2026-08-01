import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScopeRegistry } from "./scope-registry.js";

export type ReloadSubject = {
  handle: ReturnType<typeof buildDaemonHandle>;
  events: BusEvents["daemon.config.reload"][];
  refreshLiveSessionGuardrails: ReturnType<typeof vi.fn>;
  workflowRuntime: {
    setWorkflowInputs: ReturnType<typeof vi.fn>;
    reloadWorkflowDefinitions: ReturnType<typeof vi.fn>;
    getDefinitionCount: ReturnType<typeof vi.fn>;
  };
};

export function makeReloadSubject(
  initialConfig: KotaConfig = {},
  getModuleSummaries: () => readonly ModuleSummary[] = () => [],
): ReloadSubject {
  const bus = new EventBus();
  const events: BusEvents["daemon.config.reload"][] = [];
  bus.on("daemon.config.reload", (payload) => {
    events.push(payload);
  });

  const workflowRuntime = {
    setWorkflowInputs: vi.fn(),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 5 })),
    getDefinitionCount: vi.fn(() => 3),
  };
  const pbus = new ProjectScopedEventBus(bus, "test-project");
  const runtime = { workflowRuntime, pbus } as unknown as ProjectRuntime;
  const projectRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ProjectRuntimeRegistry;
  const projectRegistry = {
    get: vi.fn(),
    getDefaultProjectId: vi.fn(() => "test-project"),
    toProjection: vi.fn(() => ({ defaultProjectId: "test-project", projects: [] })),
  } as unknown as ScopeRegistry;
  const projectDir = mkdtempSync(join(tmpdir(), "kota-daemon-handle-test-"));
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
    projectDir,
    projectRegistry,
    projectRuntimes,
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

  return { handle, events, refreshLiveSessionGuardrails, workflowRuntime };
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
    project: {
      projectId: "test-project",
      projectDir: mkdtempSync(join(tmpdir(), "kota-daemon-run-test-")),
    },
    runStore,
    workflowRuntime: {
      getDefinitionCount: vi.fn(() => 0),
    },
  } as unknown as ProjectRuntime;
  const projectRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ProjectRuntimeRegistry;
  const projectRegistry = {
    get: vi.fn(),
    getDefaultProjectId: vi.fn(() => "test-project"),
    toProjection: vi.fn(() => ({ defaultProjectId: "test-project", projects: [] })),
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
    projectDir: runtime.project.projectDir,
    projectRegistry,
    projectRuntimes,
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
