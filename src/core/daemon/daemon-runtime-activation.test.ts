import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { ScopeRuntimeStateStore } from "#core/workflow/scope-runtime-state.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { Daemon, RESTART_EXIT_CODE } from "./daemon.js";
import { DaemonControlServer } from "./daemon-control.js";
import { completeRuntimeActivation, failRuntimeActivation, initializeRuntimeActivation, observeIntegratedRuntime } from "./daemon-runtime-activation.js";
import type { DaemonRuntimeRevision } from "./daemon-runtime-revision.js";
import type { DaemonState } from "./daemon-state.js";
import { loadDaemonStateFromDisk } from "./daemon-state-persistence.js";

const loaded = vi.hoisted((): Omit<DaemonRuntimeRevision, "activation" | "canonicalRevision"> => ({ root: "", mode: "source", loadedRevision: "" }));
vi.mock("./daemon-runtime-revision.js", async (original) => ({
  ...await original<typeof import("./daemon-runtime-revision.js")>(),
  LOADED_RUNTIME: loaded,
}));
vi.mock("#core/workflow/run-resources.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/run-resources.js")>();
  return {
    ...actual,
    RunResourceAllocator: class extends actual.RunResourceAllocator {
      constructor(store: RunStateDatabase, options: import("#core/workflow/run-resources.js").RunResourceAllocatorOptions) {
        super(store, { ...options, isPortAvailable: async () => true });
      }
    },
  };
});
vi.mock("#core/workflow/workflow-command.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/workflow-command.js")>();
  return {
    ...actual,
    createWorkflowCommandRunner: (options: import("#core/workflow/workflow-command.js").WorkflowCommandRunnerOptions): import("#core/workflow/workflow-command.js").WorkflowCommandRunner => async (input) => ({
      command: input.command, args: input.args ?? [], cwd: options.cwd, exitCode: 0,
      identity: { pid: 123, processGroupId: 123, observedCommandHash: "fixture", osStartToken: "fixture" },
      stdout: { text: "validated", totalBytes: 9, truncated: false },
      stderr: { text: "", totalBytes: 0, truncated: false },
    }),
  };
});

let root: string;
let stateDir: string;
const daemons: Daemon[] = [];
const gates: Array<() => void> = [];
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function commit(path: string, text: string): string {
  writeFileSync(join(root, path), text);
  git("add", path);
  git("commit", "-qm", "revision");
  return git("rev-parse", "HEAD");
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  gates.push(release);
  return { promise, release };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-runtime-activation-"));
  stateDir = join(root, ".kota");
  mkdirSync(stateDir);
  mkdirSync(join(root, "src"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "KOTA Test");
  git("config", "user.email", "kota@example.test");
  git("config", "commit.gpgsign", "false");
  commit(".gitignore", ".kota/\n");
  loaded.root = root;
  loaded.mode = "source";
  loaded.loadedRevision = commit("src/runtime.ts", "export const value = 1;\n");
  // Only the network listener is controlled; startup, publication, SQLite, Git,
  // draining, shutdown, and recovery all execute through their production owners.
  vi.spyOn(DaemonControlServer.prototype, "start").mockResolvedValue(43210);
});

afterEach(async () => {
  for (const release of gates.splice(0)) release();
  for (const daemon of daemons.splice(0)) await daemon.stop(1, "programmatic", 1000);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("runtime activation", () => {
  it("ignores documentation and external scopes, coalesces revisions, and contains failed replay", () => {
    const state: DaemonState = { pid: process.pid, startedAt: new Date().toISOString() };
    initializeRuntimeActivation(state, stateDir);
    const docs = commit("README.md", "docs\n");
    expect(observeIntegratedRuntime(state, stateDir, root, { publishedHead: docs, changedPaths: ["README.md"] })).toBe(false);
    const first = commit("src/runtime.ts", "export const value = 2;\n");
    expect(observeIntegratedRuntime(state, stateDir, stateDir, { publishedHead: first, changedPaths: ["src/runtime.ts"] })).toBe(false);
    expect(observeIntegratedRuntime(state, stateDir, root, { publishedHead: first, changedPaths: ["src/runtime.ts"] })).toBe(true);
    const second = commit("src/runtime.ts", "export const value = 3;\n");
    expect(observeIntegratedRuntime(state, stateDir, root, { publishedHead: second, changedPaths: ["src/runtime.ts"] })).toBe(true);
    expect(observeIntegratedRuntime(state, stateDir, root, { publishedHead: first, changedPaths: ["src/runtime.ts"] })).toBe(false);
    failRuntimeActivation(state, stateDir, "startup failed");
    expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toEqual({ targetRevision: second, status: "failed", error: "startup failed" });
    expect(observeIntegratedRuntime(state, stateDir, root, { publishedHead: second, changedPaths: ["src/runtime.ts"] })).toBe(false);
    loaded.loadedRevision = second;
    initializeRuntimeActivation(state, stateDir);
    completeRuntimeActivation(state, stateDir);
    expect(state.runtimeRevision?.activation?.status).toBe("active");
  });

  it("reports failure when a fresh process still loads the old build", () => {
    const state: DaemonState = { pid: process.pid, startedAt: new Date().toISOString() };
    initializeRuntimeActivation(state, stateDir);
    const target = commit("src/runtime.ts", "export const value = 2;\n");
    observeIntegratedRuntime(state, stateDir, root, { publishedHead: target, changedPaths: ["src/runtime.ts"] });
    expect(() => initializeRuntimeActivation(state, stateDir)).toThrow("Restart did not load");
    expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision).toMatchObject({
      loadedRevision: loaded.loadedRevision, canonicalRevision: target,
      activation: { targetRevision: target, status: "failed" },
    });
    const failed = loadDaemonStateFromDisk(stateDir)!;
    expect(() => initializeRuntimeActivation(failed, stateDir)).toThrow("Restart did not load");
    expect(loadDaemonStateFromDisk(stateDir)).toEqual(failed);
  });

  it.each(["stale", "unknown", "same", "descendant", "equivalent"] as const)("revalidates a previously active target against a %s replacement", (replacement) => {
    const state: DaemonState = { pid: process.pid, startedAt: new Date().toISOString() };
    const oldRevision = loaded.loadedRevision;
    initializeRuntimeActivation(state, stateDir);
    const runtimeRevision = commit("src/runtime.ts", "export const value = 2;\n");
    const target = replacement === "equivalent" ? commit("README.md", "docs\n") : runtimeRevision;
    observeIntegratedRuntime(state, stateDir, root, { publishedHead: target, changedPaths: ["src/runtime.ts"] });
    loaded.loadedRevision = target;
    initializeRuntimeActivation(state, stateDir);
    completeRuntimeActivation(state, stateDir);
    expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation?.status).toBe("active");

    loaded.mode = "built";
    loaded.loadedRevision = replacement === "stale" ? oldRevision
      : replacement === "unknown" ? null
      : replacement === "descendant" ? commit("src/runtime.ts", "export const value = 3;\n")
      : replacement === "equivalent" ? runtimeRevision : target;
    const restored = loadDaemonStateFromDisk(stateDir)!;
    if (replacement === "stale" || replacement === "unknown") {
      expect(() => initializeRuntimeActivation(restored, stateDir)).toThrow("Restart did not load");
      expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision).toMatchObject({
        mode: "built", loadedRevision: loaded.loadedRevision,
        activation: { targetRevision: target, status: "failed", error: expect.stringContaining("Restart did not load") },
      });
      expect(() => initializeRuntimeActivation(loadDaemonStateFromDisk(stateDir)!, stateDir)).toThrow("Restart did not load");
    } else {
      initializeRuntimeActivation(restored, stateDir);
      expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toMatchObject({ targetRevision: target, status: "starting" });
      completeRuntimeActivation(restored, stateDir);
      expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toEqual({ targetRevision: target, status: "active", error: null });
    }
  });

  it.each([false, true])("retains the target when replacement startup fails (previously active: %s)", async (previouslyActive) => {
    const state: DaemonState = { pid: process.pid, startedAt: new Date().toISOString() };
    initializeRuntimeActivation(state, stateDir);
    const target = commit("src/runtime.ts", "export const value = 2;\n");
    observeIntegratedRuntime(state, stateDir, root, { publishedHead: target, changedPaths: ["src/runtime.ts"] });
    loaded.loadedRevision = target;
    if (previouslyActive) {
      initializeRuntimeActivation(state, stateDir);
      completeRuntimeActivation(state, stateDir);
    }
    vi.mocked(DaemonControlServer.prototype.start).mockRejectedValueOnce(new Error("listener unavailable"));
    const daemon = new Daemon({ scopeRoot: root, workflows: [] });
    daemons.push(daemon);
    await expect(daemon.start()).rejects.toThrow("listener unavailable");
    expect(loadDaemonStateFromDisk(stateDir)?.runtimeRevision?.activation).toEqual({
      targetRevision: target, status: "failed", error: "listener unavailable",
    });
    const failed = loadDaemonStateFromDisk(stateDir)!;
    expect(() => initializeRuntimeActivation(failed, stateDir)).toThrow("listener unavailable");
    expect(loadDaemonStateFromDisk(stateDir)).toEqual(failed);
  });

  it("drains healthy work once after durable integration and preserves queued identity and operator pause", async () => {
    const running = gate();
    const release = gate();
    const releaseWriter = gate();
    const writerReady = gate();
    const workflows = [
      registerWorkflowDefinition("test/hold.ts", {
        name: "hold", repository: "none", triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
        steps: [{ id: "hold", type: "code", run: async () => { running.release(); await release.promise; return "healthy"; } }],
      }),
      registerWorkflowDefinition("test/docs.ts", {
        name: "docs", repository: "write", integration: { validationCommand: ["true"] },
        triggers: [{ event: "runtime.idle", cooldownMs: 60_000 }],
        steps: [{ id: "docs", type: "code", run: (ctx) => {
          writeFileSync(join(ctx.workspaceRoot, "README.md"), "Documentation only\n");
          return "documented";
        } }],
      }),
      registerWorkflowDefinition("test/writer.ts", {
        name: "writer", repository: "write", integration: { validationCommand: ["true"] },
        triggers: [{ event: "workflow.completed", filter: { workflow: "docs", status: "success" } }],
        steps: [{ id: "write", type: "code", run: async (ctx) => {
          await running.promise;
          writerReady.release();
          await releaseWriter.promise;
          writeFileSync(join(ctx.workspaceRoot, "src/runtime.ts"), "export const value = 2;\n");
          return "updated";
        } }],
      }),
      registerWorkflowDefinition("test/follow.ts", {
        name: "follow", repository: "none",
        triggers: [{ event: "workflow.completed", filter: { workflow: "writer", status: "success" } }],
        steps: [{ id: "follow", type: "code", run: () => "refilled" }],
      }),
    ];
    const authorityConfigPath = join(stateDir, "authority.json");
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [root] }));
    const restartExit = vi.fn();
    const config = { scopeRoot: root, authorityConfigPath, workflows, idleIntervalMs: 50, restartExit, config: { scheduler: { concurrency: 3 } } };
    const first = new Daemon(config);
    daemons.push(first);
    const firstRun = first.start();
    await first.whenReady();
    await writerReady.promise;
    expect(first.getState().runtimeRevision?.activation).toBeNull();
    expect(restartExit).not.toHaveBeenCalled();
    releaseWriter.release();
    await expect.poll(() => {
      const status = first.getState().runtimeRevision?.activation?.status;
      if (status !== undefined) return status;
      const database = RunStateDatabase.openReadOnly(stateDir);
      try {
        return database.listRuns(first.getScopeRegistryProjection().defaultScopeId)
          .map((run) => ({ workflow: run.workflow, state: run.state, error: run.lastError, wait: run.wait }));
      } finally { database.close(); }
    }, { timeout: 8000 }).toBe("draining");
    expect(first.isRunning()).toBe(true);
    const firstRuntimeId = first.getDashboardSnapshot().agentOperatingState!.runtimeId;
    expect(restartExit).not.toHaveBeenCalled();
    const store = RunStateDatabase.openReadOnly(stateDir);
    const scopeId = first.getScopeRegistryProjection().defaultScopeId;
    const follow = store.listRuns(scopeId).find((run) => run.workflow === "follow")!;
    const writer = store.listRuns(scopeId).find((run) => run.workflow === "writer")!;
    expect(writer.state).toBe("succeeded");
    expect(follow.state).toBe("queued");
    const admitted = { id: follow.id, trigger: follow.trigger, resources: follow.resources };
    store.close();
    release.release();
    await firstRun;
    expect(restartExit.mock.calls).toEqual([[RESTART_EXIT_CODE]]);

    const persisted = new RunStateDatabase(stateDir);
    const scopeState = new ScopeRuntimeStateStore(persisted, follow.scopeId);
    scopeState.setDispatchPaused(true);
    const backoff = {
      runtimeId: firstRuntimeId,
      kind: "provider" as const, failureCount: 2, reason: "provider_unavailable",
      until: new Date(Date.now() + 60_000).toISOString(), updatedAt: new Date().toISOString(),
    };
    scopeState.setAgentBackoff(backoff);
    persisted.close();
    loaded.loadedRevision = git("rev-parse", "HEAD");
    const second = new Daemon(config);
    daemons.push(second);
    const secondRun = second.start();
    await second.whenReady();
    expect(second.getState().runtimeRevision?.activation?.status).toBe("active");
    expect(second.getDashboardSnapshot().agentBackoff).toEqual(backoff);
    const recovered = RunStateDatabase.openReadOnly(stateDir);
    expect(recovered.getRun(follow.id)).toMatchObject({ ...admitted, state: "queued" });
    recovered.close();
    await second.stop();
    await secondRun;

    const resumed = new RunStateDatabase(stateDir);
    new ScopeRuntimeStateStore(resumed, follow.scopeId).setDispatchPaused(false);
    resumed.close();
    const third = new Daemon(config);
    daemons.push(third);
    const thirdRun = third.start();
    await third.whenReady();
    await expect.poll(() => third.getDashboardSnapshot().lastCompletedWorkflow).toBe("follow");
    await third.stop();
    await thirdRun;
    expect(restartExit.mock.calls).toEqual([[RESTART_EXIT_CODE]]);
  }, 20_000);
});
