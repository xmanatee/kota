import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import {
  createWorkflowDispatchDeadLetter,
  DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import { dismissSupersededWorkflowDeadLetters } from "./dead-letter-supersession.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunMetadata } from "./run-types.js";

const FAILED_RUN_ID = "2026-07-29T15-20-51-974Z-builder-mqlo2r";
const WORKTREE_RUN_ID = "2026-07-28T22-23-31-718Z-builder-v1vx68";

function builderRun(input: {
  id: string;
  status: "failed" | "success";
  taskId: string;
  sourceRunId: string;
  startedAt: string;
  completedAt: string;
}): WorkflowRunMetadata {
  return {
    id: input.id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.builder.recovery.requested",
      schemaRef: null,
      payload: {
        taskId: input.taskId,
        sourceRunId: input.sourceRunId,
        worktreeRunId: WORKTREE_RUN_ID,
        workspaceDir: `/tmp/${input.taskId}`,
        idempotencyKey: `builder-recovery:${input.sourceRunId}`,
        reason: "preserved builder work needs recovery",
      },
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: input.status,
    durationMs: 1,
    runDir: `.kota/runs/${input.id}`,
    steps: [
      {
        id: "build",
        type: "agent",
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        durationMs: 1,
        usage: UNKNOWN_AGENT_USAGE,
        ...(input.status === "failed"
          ? {
              activeDurationMs: 21_600_000,
              error: 'Step "build" timed out after 21600000ms of active runtime',
            }
          : {}),
      },
    ],
  };
}

describe("workflow dead-letter supersession", () => {
  let projectDir: string;
  let deadLetterQueue: DeadLetterQueueStore;
  let runStore: WorkflowRunStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "workflow-dlq-supersession-"));
    deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
    );
    runStore = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function persistRun(metadata: WorkflowRunMetadata): void {
    const runDir = join(runStore.runsDir, metadata.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  }

  it("dismisses a timeout only for a successful run in the failed lineage", () => {
    const failed = builderRun({
      id: FAILED_RUN_ID,
      status: "failed",
      taskId: "task-safety-one",
      sourceRunId: WORKTREE_RUN_ID,
      startedAt: "2026-07-29T15:20:51.974Z",
      completedAt: "2026-07-30T00:46:46.743Z",
    });
    persistRun(failed);
    const deadLetter = createWorkflowDispatchDeadLetter({
      store: deadLetterQueue,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger: failed.trigger,
      reason: failed.steps[0]!.error!,
      errorClass: "execution",
      failedRun: failed,
    });
    const unrelated = builderRun({
      id: "2026-07-30T01-08-00-035Z-builder-q4x7ju",
      status: "success",
      taskId: "task-safety-two",
      sourceRunId: "run-unrelated",
      startedAt: "2026-07-30T01:08:00.035Z",
      completedAt: "2026-07-30T01:20:00.000Z",
    });

    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: unrelated,
      }),
    ).toEqual([]);
    expect(deadLetterQueue.get(deadLetter.id)?.status).toBe("open");

    const retry = builderRun({
      id: "2026-07-30T02-00-00-000Z-builder-retry",
      status: "success",
      taskId: "task-safety-one",
      sourceRunId: FAILED_RUN_ID,
      startedAt: "2026-07-30T02:00:00.000Z",
      completedAt: "2026-07-30T02:20:00.000Z",
    });

    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: retry,
      }),
    ).toEqual([deadLetter.id]);
    expect(deadLetterQueue.get(deadLetter.id)).toMatchObject({
      status: "dismissed",
      dismissalReason: `Superseded by successful run ${retry.id}`,
    });
  });
});
