import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  reconcileWorkflowRecovery,
  resolveWorkflowDispatchPause,
} from "./recovery-status.js";
import type { WorkflowRecoveryStatus } from "./recovery-status-types.js";
import type { WorkflowRecoveryState } from "./run-types.js";
import { PAUSE_SIGNAL_FILE } from "./runtime-signals.js";

const DIRTY_RECOVERY_ACTION =
  "Clean or stash the dirty checkout, then run `kota workflow resume`.";

function recoveryState(): WorkflowRecoveryState {
  return {
    sourceRunId: "run-stale",
    sourceWorkflow: "builder",
    dirtyCheckout: "canonical",
    worktreeFingerprint: "M tracked.txt",
    worktreeSummary: "M tracked.txt",
    attempts: 1,
    retryAttemptedBy: [],
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}

function pendingRecoveryStatus(): Exclude<WorkflowRecoveryStatus, { status: "none" }> {
  return {
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
  };
}

describe("workflow recovery dispatch pause reconciliation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-recovery-status-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function pausePath(): string {
    return join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
  }

  function writeLegacyPauseSignal(): void {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(pausePath(), "", "utf8");
  }

  function runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  function initializeCleanGitRepo(): void {
    runGit(["init"]);
    writeFileSync(join(projectDir, "tracked.txt"), "base\n", "utf8");
    runGit(["add", "tracked.txt"]);
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

  it("clears a stale legacy empty dirty-recovery pause when the tracked checkout is clean", () => {
    initializeCleanGitRepo();
    writeLegacyPauseSignal();
    let recovery: WorkflowRecoveryState | null = recoveryState();
    const store = {
      getRecovery: () => recovery,
      setRecovery: (next: WorkflowRecoveryState | null) => {
        recovery = next;
      },
    };

    const status = reconcileWorkflowRecovery({
      projectDir,
      store,
    });

    expect(status).toEqual({ status: "none", clearedStale: true });
    expect(recovery).toBeNull();
    expect(existsSync(pausePath())).toBe(false);
  });

  it("reports a legacy empty pause signal as dirty recovery while recovery is pending", () => {
    writeLegacyPauseSignal();

    const pause = resolveWorkflowDispatchPause({
      projectDir,
      runtimePaused: false,
      recovery: pendingRecoveryStatus(),
    });

    expect(pause).toMatchObject({
      paused: true,
      kind: "dirty-recovery",
      source: "signal",
      nextAction: DIRTY_RECOVERY_ACTION,
    });
  });

  it("keeps a legacy empty pause signal as an operator pause without recovery state", () => {
    writeLegacyPauseSignal();

    const pause = resolveWorkflowDispatchPause({
      projectDir,
      runtimePaused: false,
      recovery: { status: "none" },
    });

    expect(pause).toMatchObject({
      paused: true,
      kind: "operator",
      source: "signal",
      nextAction: "Run `kota workflow resume` to re-enable dispatch.",
    });
  });
});
