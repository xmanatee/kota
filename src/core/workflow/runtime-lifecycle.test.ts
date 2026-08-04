import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { writeDirtyRecoveryPauseSignal } from "./recovery-status.js";
import { WorkflowRunStore } from "./run-store.js";
import { PAUSE_SIGNAL_FILE, WorkflowRuntime } from "./runtime.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WorkflowRuntime dispatch pause persistence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-pause-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function pausePath(): string {
    return join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
  }

  function runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  function initializeCleanGitRepo(): void {
    runGit(["init", "-q", "-b", "main"]);
    writeFileSync(join(projectDir, ".gitignore"), ".kota/\n", "utf8");
    writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf8");
    runGit(["add", ".gitignore", "tracked.txt"]);
    runGit([
      "-c",
      "user.name=KOTA Test",
      "-c",
      "user.email=kota@example.invalid",
      "commit",
      "-m",
      "initial",
    ]);
  }

  function persistRunningRun(store: WorkflowRunStore, id: string, workflow: string): void {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const runDir = join(projectDir, ".kota", "runs", id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id,
        workflow,
        definitionPath: "src/core/workflow/runtime-lifecycle.test.ts",
        trigger: { event: "manual", schemaRef: null, payload: {} },
        startedAt,
        status: "running",
        runDir: `.kota/runs/${id}`,
        steps: [],
      }),
    );
    const state = store.readState();
    state.activeRuns = [{ runId: id, workflow, startedAt }];
    // biome-ignore lint/complexity/useLiteralKeys: fixture must simulate a crashed runtime.
    store["writeState"](state);
  }

  it("writes and removes the persisted operator pause marker", () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });

    runtime.setDispatchPaused(true, "persistent");

    expect(existsSync(pausePath())).toBe(true);
    expect(runtime.isDispatchPaused()).toBe(true);

    runtime.setDispatchPaused(false, "persistent");

    expect(existsSync(pausePath())).toBe(false);
    expect(runtime.isDispatchPaused()).toBe(false);
  });

  it("keeps temporary runtime pauses separate from the persisted marker", () => {
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(pausePath(), "");

    runtime.setDispatchPaused(false);

    expect(existsSync(pausePath())).toBe(true);
    expect(runtime.isDispatchPaused()).toBe(true);
  });

  it("restores pending work without dispatch until an atomic startup is released", async () => {
    let executions = 0;
    const config = {
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [{
        name: "atomic-startup",
        definitionPath: "src/core/workflow/runtime-lifecycle.test.ts",
        moduleRoot: process.cwd(),
        triggers: [{ event: "manual" }],
        steps: [{
          id: "record",
          type: "code" as const,
          run: () => {
            executions += 1;
            return "recorded";
          },
        }],
      }],
    };
    const first = new WorkflowRuntime(config);
    first.start("paused");
    expect(first.enqueuePendingRun("atomic-startup").ok).toBe(true);
    await first.stop(0);

    const restored = new WorkflowRuntime(config);
    restored.start("paused");
    await wait(20);

    expect(restored.isDispatchPaused()).toBe(true);
    expect(restored.getState().pendingRuns).toHaveLength(1);
    expect(executions).toBe(0);

    restored.setDispatchPaused(false);
    for (let attempt = 0; attempt < 100 && executions === 0; attempt += 1) {
      await wait(10);
    }
    expect(executions).toBe(1);
    await restored.stop(0);
  });

  it("queues targeted recovery for an interrupted workflow when the checkout is clean", async () => {
    initializeCleanGitRepo();
    const store = new WorkflowRunStore(projectDir);
    persistRunningRun(store, "run-interrupted", "recoverable-workflow");
    const recoveryWorkflow = (name: string) => ({
      name,
      definitionPath: "src/core/workflow/runtime-lifecycle.test.ts",
      moduleRoot: process.cwd(),
      recoveryCapable: true,
      triggers: [{ event: "runtime.recovered" }],
      steps: [{ id: "recover", type: "code" as const, run: () => undefined }],
    });
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        recoveryWorkflow("recoverable-workflow"),
        recoveryWorkflow("unrelated-recovery-workflow"),
      ],
    });

    runtime.start("paused");

    expect(runtime.getState().pendingRuns).toMatchObject([
      {
        workflowName: "recoverable-workflow",
        trigger: {
          event: "runtime.recovered",
          payload: {
            recoveredRunIds: ["run-interrupted"],
            recoveredWorkflows: ["recoverable-workflow"],
          },
        },
      },
    ]);
    await runtime.stop(0);
  });

  it("clears stale dirty-recovery state during startup when the tracked checkout is clean", async () => {
    initializeCleanGitRepo();
    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-stale",
      sourceWorkflow: "builder",
      dirtyCheckout: "canonical",
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    writeDirtyRecoveryPauseSignal(projectDir, {
      status: "pending",
      sourceRunId: "run-stale",
      sourceWorkflow: "builder",
      dirtyCheckout: "canonical",
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-07-07T00:00:00.000Z",
      nextAction: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
    });

    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [],
    });

    runtime.start();
    await runtime.stop(0);

    expect(store.getRecovery()).toBeNull();
    expect(existsSync(pausePath())).toBe(false);
    expect(runtime.getRecoveryStatus()).toEqual({ status: "none" });
    expect(runtime.getDispatchPauseStatus()).toEqual({ paused: false, kind: "none" });
  });

  it("keeps restored pending work when dirty recovery is exhausted", async () => {
    initializeCleanGitRepo();
    writeFileSync(join(projectDir, "tracked.txt"), "dirty\n", "utf8");
    const dirty = getRepoWorktreeStatus(projectDir);
    const store = new WorkflowRunStore(projectDir);
    store.setPendingRuns([{
      runId: "queued-before-recovery",
      workflowName: "pending-work",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      enqueuedAtMs: 1,
      notBeforeMs: 1,
    }]);
    store.setRecovery({
      sourceRunId: "run-dirty",
      sourceWorkflow: "improver",
      dirtyCheckout: "canonical",
      worktreeFingerprint: dirty.fingerprint,
      worktreeSummary: dirty.summary,
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
    const runtime = new WorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [{
        name: "pending-work",
        definitionPath: "src/core/workflow/runtime-lifecycle.test.ts",
        moduleRoot: process.cwd(),
        triggers: [{ event: "manual" }],
        steps: [{ id: "noop", type: "code", run: () => undefined }],
      }],
    });

    runtime.start();
    await wait(20);

    expect(runtime.isDispatchPaused()).toBe(true);
    expect(runtime.getState().pendingRuns.map((run) => run.runId)).toEqual([
      "queued-before-recovery",
    ]);
    await runtime.stop(0);
    expect(store.readState().pendingRuns.map((run) => run.runId)).toEqual([
      "queued-before-recovery",
    ]);
  });
});
