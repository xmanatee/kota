import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { writeDirtyRecoveryPauseSignal } from "#core/workflow/recovery-status.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime.js";
import type { WorkflowClient } from "./client.js";
import workflowOpsModule from "./index.js";

const DIRTY_RECOVERY_ACTION =
  "Clean or stash the dirty checkout, then run `kota workflow resume`.";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-wf-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return realpathSync(dir);
}

function buildHandler(projectDir: string): WorkflowClient {
  const ctx = { cwd: projectDir } as unknown as ModuleContext;
  const handlers = workflowOpsModule.localClient!(ctx);
  if (!handlers.workflow) throw new Error("workflow handler missing");
  return handlers.workflow;
}

function runGit(projectDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initializeCleanGitRepo(projectDir: string): void {
  runGit(projectDir, ["init"]);
  writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf8");
  runGit(projectDir, ["add", "tracked.txt"]);
  runGit(projectDir, [
    "-c",
    "user.name=KOTA Test",
    "-c",
    "user.email=kota@example.invalid",
    "commit",
    "-m",
    "initial",
  ]);
}

describe("workflow-ops localClient recovery status", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("status clears stale dirty-recovery records when the tracked checkout is clean", async () => {
    initializeCleanGitRepo(projectDir);
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
      nextAction: DIRTY_RECOVERY_ACTION,
    });

    const snapshot = await buildHandler(projectDir).status();

    expect(snapshot.recovery).toEqual({ status: "none", clearedStale: true });
    expect(snapshot.paused).toBe(false);
    expect(snapshot.pause).toEqual({ paused: false, kind: "none" });
    expect(store.getRecovery()).toBeNull();
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(false);
  });

  it("status exposes dirty recovery details and resume keeps dispatch paused", async () => {
    initializeCleanGitRepo(projectDir);
    writeFileSync(join(projectDir, "tracked.txt"), "dirty\n", "utf8");
    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-dirty",
      sourceWorkflow: "improver",
      dirtyCheckout: "canonical",
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [
        {
          workflow: "improver",
          runId: "retry-run",
          attemptedAt: "2026-07-07T00:01:00.000Z",
        },
      ],
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    writeDirtyRecoveryPauseSignal(projectDir, {
      status: "pending",
      sourceRunId: "run-dirty",
      sourceWorkflow: "improver",
      dirtyCheckout: "canonical",
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-07-07T00:00:00.000Z",
      nextAction: DIRTY_RECOVERY_ACTION,
    });

    const handler = buildHandler(projectDir);
    const snapshot = await handler.status();

    expect(snapshot.paused).toBe(true);
    expect(snapshot.pause).toMatchObject({
      paused: true,
      kind: "dirty-recovery",
      source: "signal",
      nextAction: DIRTY_RECOVERY_ACTION,
    });
    expect(snapshot.recovery).toMatchObject({
      status: "pending",
      sourceRunId: "run-dirty",
      sourceWorkflow: "improver",
      dirtyCheckout: "canonical",
      attempts: 1,
      nextAction: DIRTY_RECOVERY_ACTION,
    });
    if (snapshot.recovery?.status !== "pending") {
      throw new Error("expected pending recovery");
    }
    expect(snapshot.recovery.worktreeSummary).toContain("tracked.txt");

    await expect(handler.resume()).resolves.toEqual({
      paused: true,
      already: true,
      blocked: "dirty-recovery",
      message: DIRTY_RECOVERY_ACTION,
    });
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(true);
  });

  it("does not clear workspace recovery when the workspace path is unavailable", async () => {
    initializeCleanGitRepo(projectDir);
    const store = new WorkflowRunStore(projectDir);
    store.setRecovery({
      sourceRunId: "run-workspace",
      sourceWorkflow: "builder",
      dirtyCheckout: "workspace",
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-07-07T00:00:00.000Z",
    });

    const snapshot = await buildHandler(projectDir).status();

    expect(snapshot.recovery).toMatchObject({
      status: "unavailable",
      sourceRunId: "run-workspace",
      sourceWorkflow: "builder",
      dirtyCheckout: "workspace",
      unavailableReason: "workspace checkout path unavailable for dirty recovery",
      nextAction: "Fix git status access before clearing recovery or resuming dispatch.",
    });
    expect(store.getRecovery()).toMatchObject({
      sourceRunId: "run-workspace",
      dirtyCheckout: "workspace",
    });
  });
});
