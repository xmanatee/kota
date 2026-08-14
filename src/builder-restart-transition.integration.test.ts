import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-directory.js";
import { EventBus } from "#core/events/event-bus.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { CLAIMED_TASK_CONSISTENCY_STEP_ID } from "#modules/autonomy/workflows/builder/claimed-task-consistency-step.js";
import builderWorkflow from "#modules/autonomy/workflows/builder/workflow.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error("condition was not met before timeout");
}

function builderHandoffSteps(): WorkflowStepInput[] {
  const handoffIds = new Set(["request-restart", "emit-build-committed"]);
  return builderWorkflow.steps.filter((step) => handoffIds.has(step.id));
}

function transitionBuilder(): WorkflowDefinitionInput {
  return {
    name: "builder-transition-fixture",
    triggers: [{ event: "autonomy.queue.available" }],
    steps: [
      {
        id: CLAIMED_TASK_CONSISTENCY_STEP_ID,
        type: "code",
        run: () => ({
          matched: true,
          taskId: "task-calibration-repair",
          claimedTaskId: "task-calibration-repair",
          completedTaskId: "task-calibration-repair",
        }),
      },
      {
        id: "commit",
        type: "code",
        run: () => ({
          committed: true,
          committedPaths: ["src/modules/autonomy/critic.ts"],
          daemonRestartRequired: true,
        }),
      },
      {
        id: "write-run-summary",
        type: "code",
        run: () => ({
          commitMessage: "repair evaluator calibration",
          costUsd: null,
          durationMs: 1,
        }),
      },
      ...builderHandoffSteps(),
    ],
  };
}

function monitorDefinition(marker: string): WorkflowDefinitionInput {
  return {
    name: "evaluator-calibration-monitor-transition-fixture",
    triggers: [{ event: "workflow.build.committed" }],
    steps: [
      {
        id: "record-definition",
        type: "code",
        run: ({ projectDir }) => {
          writeFileSync(join(projectDir, `${marker}.txt`), `${marker}\n`);
          return marker;
        },
      },
    ],
  };
}

describe("builder restart transition", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("persists source-changing build handoffs until the restarted runtime loads new definitions", async () => {
    expect(builderHandoffSteps().map((step) => step.id)).toEqual([
      "request-restart",
      "emit-build-committed",
    ]);

    const projectDir = mkdtempSync(join(tmpdir(), "builder-restart-transition-"));
    projectDirs.push(projectDir);
    mkdirSync(join(projectDir, ".kota"), { recursive: true });

    const firstBus = new EventBus();
    const firstRuntime = new WorkflowRuntime({
      bus: firstBus,
      projectDir,
      idleIntervalMs: 10_000,
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/builder-transition.ts", transitionBuilder()),
        registerWorkflowDefinition("test/old-monitor.ts", monitorDefinition("old-definition")),
      ],
    });
    firstBus.on("runtime.restart_requested", () => {
      firstRuntime.setDispatchPaused(true);
    });

    firstRuntime.start();
    const projectId = deriveDirectoryScopeId(projectDir);
    firstBus.emit("autonomy.queue.available", {
      projectId,
      pullableCount: 1,
      actionableCount: 1,
      counts: {
        backlog: 0,
        ready: 1,
        doing: 0,
        blocked: 0,
        done: 0,
        dropped: 0,
      },
      dependencyBlockedTasks: [],
    });
    await waitUntil(() => {
      const state = new WorkflowRunStore(projectDir).readState();
      return state.pendingRuns.some(
        (run) =>
          run.workflowName === "evaluator-calibration-monitor-transition-fixture",
      );
    });
    await firstRuntime.stop();

    expect(() => readFileSync(join(projectDir, "old-definition.txt"), "utf8")).toThrow();

    const secondBus = new EventBus();
    const secondRuntime = new WorkflowRuntime({
      bus: secondBus,
      projectDir,
      idleIntervalMs: 10_000,
      codeConcurrency: 1,
      workflows: [
        registerWorkflowDefinition("test/new-monitor.ts", monitorDefinition("new-definition")),
      ],
    });
    secondRuntime.start();
    await waitUntil(() => existsSync(join(projectDir, "new-definition.txt")));
    await secondRuntime.stop();

    expect(readFileSync(join(projectDir, "new-definition.txt"), "utf8")).toBe(
      "new-definition\n",
    );
    expect(
      new WorkflowRunStore(projectDir).readState().pendingRuns,
    ).toHaveLength(0);
  });
});
