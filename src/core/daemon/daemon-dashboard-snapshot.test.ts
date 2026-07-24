import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import { writeDirtyRecoveryPauseSignal } from "#core/workflow/recovery-status.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime.js";
import { Daemon } from "./daemon.js";

describe("Daemon dashboard snapshot recovery state", () => {
  let projectDir: string;

  beforeEach(() => {
    resetProviderRegistry();
    projectDir = mkdtempSync(join(tmpdir(), "kota-daemon-dashboard-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    resetProviderRegistry();
  });

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

  it("reconciles stale dirty-recovery records before rendering the dashboard snapshot", () => {
    initializeCleanGitRepo();
    const store = new WorkflowRunStore(projectDir);
    const recovery = {
      sourceRunId: "run-stale",
      sourceWorkflow: "builder",
      dirtyCheckout: "canonical" as const,
      worktreeFingerprint: "M tracked.txt",
      worktreeSummary: "M tracked.txt",
      attempts: 1,
      retryAttemptedBy: [],
      updatedAt: "2026-07-07T00:00:00.000Z",
    };
    const nextAction = "Clean or stash the dirty checkout, then run `kota workflow resume`.";
    store.setRecovery(recovery);
    writeDirtyRecoveryPauseSignal(projectDir, {
      status: "pending",
      ...recovery,
      nextAction,
    });

    const daemon = new Daemon({ projectDir });
    const snapshot = daemon.getDashboardSnapshot();

    expect(snapshot.recovery).toBeUndefined();
    expect(snapshot.dispatchPaused).toBe(false);
    expect(snapshot.dispatchPause).toEqual({ paused: false, kind: "none" });
    expect(store.getRecovery()).toBeNull();
    expect(existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE))).toBe(false);
  });
});
