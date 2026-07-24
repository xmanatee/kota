import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { writeDirtyRecoveryPauseSignal } from "./recovery-status.js";
import { WorkflowRunStore } from "./run-store.js";
import { PAUSE_SIGNAL_FILE, WorkflowRuntime } from "./runtime.js";

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
});
