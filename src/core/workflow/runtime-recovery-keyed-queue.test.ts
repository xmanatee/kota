import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { WorkflowRunStore } from "./run-store.js";
import { WorkflowRuntime } from "./runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

const RECOVERY_EVENT = "autonomy.builder.recovery.requested";
const RECOVERY_PAYLOAD = {
  taskId: "task-safety-one",
  sourceRunId: "builder-failed-run",
  worktreeRunId: "builder-original-run",
  workspaceDir: "/tmp/preserved-builder",
  idempotencyKey: "builder-recovery:builder-failed-run",
  reason: "preserved builder work from builder-failed-run requires recovery",
};

function makeProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-keyed-recovery-"));
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n", "utf8");
  writeFileSync(join(projectDir, "tracked.txt"), "clean\n", "utf8");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: projectDir,
  });
  execFileSync("git", ["add", ".gitignore", "tracked.txt"], { cwd: projectDir });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: projectDir },
  );
  return projectDir;
}

describe("runtime recovery with explicitly keyed queued work", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("retains a builder continuation while its recovery scan replays the request", async () => {
    const projectDir = makeProjectDir();
    projectDirs.push(projectDir);
    const processed: string[] = [];
    const logs: string[] = [];
    const workflow: RegisteredWorkflowDefinitionInput = {
      name: "builder-recovery-restart-fixture",
      definitionPath: "src/core/workflow/runtime-recovery-keyed-queue.test.ts",
      moduleRoot: process.cwd(),
      recoveryCapable: true,
      triggers: [
        { event: RECOVERY_EVENT, cooldownMs: 0 },
        { event: "runtime.recovered", cooldownMs: 0 },
      ],
      steps: [
        {
          id: "recover",
          type: "code",
          run: (ctx) => {
            processed.push(ctx.trigger.event);
            if (ctx.trigger.event === "runtime.recovered") {
              writeFileSync(join(projectDir, "tracked.txt"), "clean\n", "utf8");
              ctx.emit(RECOVERY_EVENT, RECOVERY_PAYLOAD);
            }
            return { recovered: true };
          },
        },
      ],
    };

    const firstBus = new EventBus();
    const firstPbus = new ProjectScopedEventBus(firstBus, "scope-a");
    const firstRuntime = new WorkflowRuntime({
      bus: firstBus,
      pbus: firstPbus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [workflow],
    });
    firstRuntime.start();
    firstRuntime.setDispatchPaused(true);
    firstPbus.emit(RECOVERY_EVENT, RECOVERY_PAYLOAD);
    expect(firstRuntime.getState().pendingRuns).toHaveLength(1);
    await firstRuntime.stop();

    writeFileSync(join(projectDir, "tracked.txt"), "dirty\n", "utf8");
    const dirty = getRepoWorktreeStatus(projectDir);
    new WorkflowRunStore(projectDir).setRecovery({
      sourceRunId: "interrupted-run",
      sourceWorkflow: "builder-recovery-restart-fixture",
      dirtyCheckout: "canonical",
      worktreeFingerprint: dirty.fingerprint,
      worktreeSummary: dirty.summary,
      attempts: 0,
      retryAttemptedBy: [],
      updatedAt: "2026-07-30T02:25:30.141Z",
    });

    const secondBus = new EventBus();
    const secondRuntime = new WorkflowRuntime({
      bus: secondBus,
      pbus: new ProjectScopedEventBus(secondBus, "scope-a"),
      projectDir,
      idleIntervalMs: 60_000,
      onLog: (message) => logs.push(message),
      workflows: [workflow],
    });
    secondRuntime.start();
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      (processed.length < 2 ||
        secondRuntime.isBusy() ||
        secondRuntime.getState().pendingRuns.length > 0)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await secondRuntime.stop();

    expect(
      processed,
      JSON.stringify({
        logs,
        pendingRuns: secondRuntime.getState().pendingRuns,
        recovery: secondRuntime.getState().recovery,
      }),
    ).toEqual(["runtime.recovered", RECOVERY_EVENT]);
    expect(secondRuntime.getState().pendingRuns).toHaveLength(0);
    expect(logs.join("\n")).toContain('idempotency status "replayed"');
    expect(logs.join("\n")).not.toContain('idempotency status "rejected"');
  });
});
