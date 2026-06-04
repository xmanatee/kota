import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import { EventBus } from "#core/events/event-bus.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScopeRegistry } from "./scope-registry.js";

vi.mock("#core/config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

vi.mock("#core/modules/module-metadata.js", () => ({
  loadModuleMetadata: vi.fn(),
}));

type ReloadSubject = {
  handle: ReturnType<typeof buildDaemonHandle>;
  events: BusEvents["daemon.config.reload"][];
  refreshLiveSessionGuardrails: ReturnType<typeof vi.fn>;
  workflowRuntime: {
    setWorkflowInputs: ReturnType<typeof vi.fn>;
    reloadWorkflowDefinitions: ReturnType<typeof vi.fn>;
    getDefinitionCount: ReturnType<typeof vi.fn>;
  };
};

function makeReloadSubject(initialConfig: KotaConfig = {}): ReloadSubject {
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
  const runtime = { workflowRuntime } as unknown as ProjectRuntime;
  const projectRuntimes = {
    list: vi.fn(() => [runtime]),
    getDefault: vi.fn(() => runtime),
    get: vi.fn(() => runtime),
  } as unknown as ProjectRuntimeRegistry;
  const projectRegistry = {
    get: vi.fn(),
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
      completedRuns: 0,
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
    config: { config: initialConfig, verbose: false },
    refreshLiveSessionGuardrails,
    log: () => {},
    getModuleHealthChecks: () => ({}),
    probeCapabilityReadiness: async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    }),
    getChannelStatuses: () => [],
  });

  return { handle, events, refreshLiveSessionGuardrails, workflowRuntime };
}

function mockModuleMetadata(): void {
  vi.mocked(loadModuleMetadata).mockResolvedValue({
    getModuleSummaries: () => [
      { name: "git", dependencies: [] },
      { name: "github", dependencies: ["git"] },
      { name: "filesystem", dependencies: [] },
    ],
    getContributedWorkflows: () => [{ name: "builder", triggers: [], steps: [] }],
  } as unknown as Awaited<ReturnType<typeof loadModuleMetadata>>);
}

describe("buildDaemonHandle reloadConfig events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a typed successful config reload event with changed modules and workflow count", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({
      modules: { git: { token: "new" } },
    });
    const subject = makeReloadSubject({
      modules: { git: { token: "old" } },
    });

    const result = await subject.handle.reloadConfig();

    expect(result).toEqual({
      workflows: 5,
      changedModules: ["git", "github"],
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
    expect(subject.workflowRuntime.setWorkflowInputs).toHaveBeenCalledWith([
      { name: "builder", triggers: [], steps: [] },
    ]);
    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toMatchObject({
      scope: "daemon",
      outcome: "success",
      reloadKind: "module-scoped",
      fullReload: false,
      changedModules: ["git", "github"],
      workflowCount: 5,
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
    expect(subject.events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits a no-op reload event when config produces no changed modules", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({});
    const subject = makeReloadSubject({});

    await subject.handle.reloadConfig();

    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toMatchObject({
      outcome: "success",
      reloadKind: "noop",
      fullReload: false,
      changedModules: [],
      workflowCount: 5,
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    });
  });

  it("reports serve-owned sessions as non-refreshable on reload", async () => {
    mockModuleMetadata();
    vi.mocked(loadConfig).mockReturnValue({
      guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
    });
    const subject = makeReloadSubject({});
    subject.handle.registerSession("serve-1", "2026-01-01T00:00:00.000Z", "supervised");

    const result = await subject.handle.reloadConfig();

    expect(subject.refreshLiveSessionGuardrails).toHaveBeenCalledWith({
      policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
    });
    expect(result.sessionGuardrails).toEqual({
      refreshed: 0,
      unchanged: 0,
      nonRefreshable: [
        { id: "serve-1", source: "serve", reason: "serve-owned-session" },
      ],
    });
    expect(subject.events[0]).toMatchObject({
      sessionGuardrails: result.sessionGuardrails,
    });
  });

  it("emits a sanitized failure event before rethrowing reload errors", async () => {
    vi.mocked(loadConfig).mockImplementation(() => {
      throw new Error("raw secret token should not leave the caller");
    });
    const subject = makeReloadSubject({});

    await expect(subject.handle.reloadConfig()).rejects.toThrow("raw secret token");

    expect(subject.events).toHaveLength(1);
    expect(subject.events[0]).toEqual({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      scope: "daemon",
      outcome: "failure",
      reloadKind: "failed",
      fullReload: false,
      changedModules: [],
      workflowCount: 3,
      errorClass: "Error",
      errorMessage: "Config reload failed",
    });
  });
});
