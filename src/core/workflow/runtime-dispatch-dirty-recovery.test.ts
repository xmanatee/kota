import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowRunMetadata, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import { handleDirtyCompletion } from "./runtime-dispatch-dirty-recovery.js";
import type { WorkflowDefinition } from "./types.js";

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-dirty-recovery-"));
  writeFileSync(join(dir, "tracked.txt"), "clean\n");
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "tracked.txt"], { cwd: dir, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: dir, stdio: "ignore" },
  );
  writeFileSync(join(dir, "tracked.txt"), "dirty\n");
  return dir;
}

function makeCleanProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kota-dirty-recovery-"));
  writeFileSync(join(dir, "tracked.txt"), "clean\n");
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "tracked.txt"], { cwd: dir, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: dir, stdio: "ignore" },
  );
  return dir;
}

function makeDefinition(name = "builder"): WorkflowDefinition {
  return {
    name,
    enabled: true,
    moduleRoot: process.cwd(),
    recoveryCapable: true,
    tags: [],
    definitionPath: "src/core/workflow/runtime-dispatch-dirty-recovery.test.ts",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(id = "run-builder"): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/core/workflow/runtime-dispatch-dirty-recovery.test.ts",
    status: "success",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    steps: [],
    runDir: `.kota/runs/${id}`,
    startedAt: "2026-06-21T00:00:00.000Z",
    completedAt: "2026-06-21T00:00:01.000Z",
    durationMs: 1000,
  } as WorkflowRunMetadata;
}

function makeState(
  projectDir: string,
  recovery: WorkflowRuntimeState["recovery"] = undefined,
  workspaceDir = projectDir,
  activeRunId = "run-builder",
) {
  const logs: string[] = [];
  let storedRecovery = recovery;
  const queueWrites: unknown[][] = [];
  let queuePersistCount = 0;
  const emit = vi.fn();
  const state = {
    projectDir,
    workspaceDir,
    dispatchPaused: false,
    activeRuns: new Map([
      [
        activeRunId,
        { runId: activeRunId, workflowName: "builder" },
      ],
    ]),
    store: {
      getRecovery: () => storedRecovery ?? null,
      setRecovery: (next: WorkflowRuntimeState["recovery"] | null) => {
        storedRecovery = next ?? undefined;
      },
    },
    wfQueue: {
      setRuns: (runs: unknown[]) => {
        queueWrites.push(runs);
      },
      persist: () => {
        queuePersistCount += 1;
      },
    },
    pbus: { emit },
    log: (message: string) => logs.push(message),
  } as unknown as WorkflowRuntimeDispatchState;
  return {
    state,
    logs,
    emit,
    getRecovery: () => storedRecovery,
    getQueueWrites: () => queueWrites,
    getQueuePersistCount: () => queuePersistCount,
  };
}

describe("handleDirtyCompletion", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pauses dispatch when a run starts and ends on the same dirty fingerprint", () => {
    const projectDir = makeProjectDir();
    dirs.push(projectDir);
    const preRunFingerprint = getRepoWorktreeStatus(projectDir).fingerprint;
    const {
      state,
      getRecovery,
      getQueuePersistCount,
      getQueueWrites,
      logs,
    } = makeState(projectDir);

    handleDirtyCompletion(state, makeDefinition(), makeMetadata(), preRunFingerprint);

    expect(state.dispatchPaused).toBe(true);
    expect(getQueueWrites()).toEqual([[]]);
    expect(getQueuePersistCount()).toBe(1);
    expect(getRecovery()).toMatchObject({
      sourceRunId: "run-builder",
      sourceWorkflow: "builder",
      dirtyCheckout: "canonical",
      attempts: 1,
      worktreeFingerprint: preRunFingerprint,
    });
    expect(logs.join("\n")).toContain("already dirty before");
  });

  it("attributes dirty recovery to workspaceDir while canonical projectDir stays clean", () => {
    const projectDir = makeCleanProjectDir();
    const workspaceDir = makeCleanProjectDir();
    dirs.push(projectDir, workspaceDir);
    writeFileSync(join(workspaceDir, "tracked.txt"), "workspace dirty\n");
    const workspaceStatus = getRepoWorktreeStatus(workspaceDir);
    const projectStatus = getRepoWorktreeStatus(projectDir);
    const { state, getRecovery, logs, emit } = makeState(
      projectDir,
      undefined,
      workspaceDir,
    );

    handleDirtyCompletion(state, makeDefinition(), makeMetadata(), "clean-before-run");

    expect(projectStatus.trackedDirty).toBe(false);
    expect(state.dispatchPaused).toBe(true);
    expect(getRecovery()).toMatchObject({
      sourceRunId: "run-builder",
      sourceWorkflow: "builder",
      dirtyCheckout: "workspace",
      attempts: 0,
      worktreeFingerprint: workspaceStatus.fingerprint,
      worktreeSummary: workspaceStatus.summary,
    });
    expect(logs.join("\n")).toContain("workspace checkout");
    expect(emit).toHaveBeenCalledWith(
      "runtime.restart_requested",
      expect.objectContaining({
        reason: expect.stringContaining("dirty workspace checkout"),
      }),
    );
  });

  it("pauses dispatch when an existing recovery fingerprint is still dirty", () => {
    const projectDir = makeProjectDir();
    dirs.push(projectDir);
    const preRunFingerprint = getRepoWorktreeStatus(projectDir).fingerprint;
    const {
      state,
      getRecovery,
      getQueuePersistCount,
      getQueueWrites,
      logs,
    } = makeState(
      projectDir,
      {
        sourceRunId: "source-run",
        sourceWorkflow: "builder",
        dirtyCheckout: "canonical",
        worktreeFingerprint: preRunFingerprint,
        worktreeSummary: "M tracked.txt",
        attempts: 0,
        retryAttemptedBy: [],
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
      projectDir,
      "retry-run",
    );

    handleDirtyCompletion(state, makeDefinition(), makeMetadata("retry-run"), preRunFingerprint);

    expect(state.dispatchPaused).toBe(true);
    expect(getQueueWrites()).toEqual([[]]);
    expect(getQueuePersistCount()).toBe(1);
    expect(getRecovery()?.sourceRunId).toBe("source-run");
    expect(getRecovery()?.retryAttemptedBy).toEqual([
      expect.objectContaining({ workflow: "builder", runId: "retry-run" }),
    ]);
    expect(logs.join("\n")).toContain("recovery already owns the same fingerprint");
  });
});
