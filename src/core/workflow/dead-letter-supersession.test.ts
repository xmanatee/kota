import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import {
  createWorkflowDispatchDeadLetter,
  DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import { dismissSupersededWorkflowDeadLetters } from "./dead-letter-supersession.js";
import type { StoredRun } from "./run-state-types.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

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

function runtimeHealthAuditRun(input: {
  id: string;
  status: "failed" | "success";
  startedAt: string;
  completedAt: string;
  error?: string;
}): WorkflowRunMetadata {
  return {
    id: input.id,
    workflow: "runtime-health-auditor",
    definitionPath:
      "src/modules/autonomy/workflows/runtime-health-auditor/workflow.ts",
    trigger: {
      event: "autonomy.runtime-health.audit.scheduled",
      schemaRef: null,
      payload: { scheduledAt: input.startedAt },
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: input.status,
    durationMs: 1,
    runDir: `.kota/runs/${input.id}`,
    steps: [
      {
        id: "build-runtime-audit",
        type: "code",
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        durationMs: 1,
        ...(input.status === "failed"
          ? {
              error: input.error ?? "Runtime health audit failed",
            }
          : {}),
      },
    ],
  };
}

describe("workflow dead-letter supersession", () => {
  let workspaceRoot: string;
  let deadLetterQueue: DeadLetterQueueStore;
  let runStore: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "workflow-dlq-supersession-"));
    deadLetterQueue = new DeadLetterQueueStore(
      join(workspaceRoot, ".kota", "dead-letter-queue"),
      () => new Date("2026-07-30T05:00:00.000Z"),
    );
    runStore = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
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

  it("dismisses a metadata-authority failure only after repair and a subsequent audit success", () => {
    const historicalRunId =
      "2026-07-29T02-00-00-000Z-builder-historical";
    const historicalTrigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { taskId: "task-historical" },
    } as const;
    const historicalDefinition: WorkflowDefinition = {
      name: "builder",
      description: "historical builder",
      enabled: true,
      repository: "none",
      tags: ["autonomy"],
      definitionPath:
        "src/modules/autonomy/workflows/builder/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [{ event: historicalTrigger.event, cooldownMs: 0 }],
      steps: [{ id: "build", type: "code", run: () => undefined }],
    };
    runStore.createRun(
      historicalDefinition,
      historicalTrigger,
      historicalRunId,
    );
    const historicalMetadataPath = join(
      runStore.runsDir,
      historicalRunId,
      "metadata.json",
    );
    const malformed = JSON.parse(
      readFileSync(historicalMetadataPath, "utf8"),
    ) as Record<string, unknown>;
    malformed.definitionPath = 17;
    writeFileSync(
      historicalMetadataPath,
      `${JSON.stringify(malformed, null, 2)}\n`,
      "utf8",
    );
    const authorityFailure =
      `Workflow run metadata authority is invalid at ${historicalMetadataPath}: definitionPath is invalid`;
    const failed = runtimeHealthAuditRun({
      id: "2026-07-30T03-00-00-000Z-runtime-health-auditor-failed",
      status: "failed",
      startedAt: "2026-07-30T03:00:00.000Z",
      completedAt: "2026-07-30T03:01:00.000Z",
      error: authorityFailure,
    });
    persistRun(failed);
    const deadLetter = createWorkflowDispatchDeadLetter({
      store: deadLetterQueue,
      scopeId: "scope-a",
      workflowName: failed.workflow,
      trigger: failed.trigger,
      reason: failed.steps[0]!.error!,
      errorClass: "execution",
      failedRun: failed,
    });
    const successful = runtimeHealthAuditRun({
      id: "2026-07-30T04-00-00-000Z-runtime-health-auditor-success",
      status: "success",
      startedAt: "2026-07-30T04:00:00.000Z",
      completedAt: "2026-07-30T04:01:00.000Z",
    });

    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: successful,
      }),
    ).toEqual([]);
    expect(deadLetterQueue.get(deadLetter.id)?.status).toBe("open");

    const durableHistoricalRun: StoredRun = {
      id: historicalRunId,
      scopeId: "scope-a",
      workflow: "builder",
      trigger: historicalTrigger,
      repository: "none",
      state: "failed",
      resources: [],
      admittedAt: "2026-07-29T01:59:59.000Z",
      attempt: 1,
      startedAt: "2026-07-29T02:00:00.000Z",
      finishedAt: "2026-07-29T02:01:00.000Z",
      resultStatus: "failed",
      processes: [],
    };
    const repair = runStore.repairMetadataFromDurableAuthority(
      durableHistoricalRun,
    );
    expect(repair.kind).toBe("repaired");

    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: successful,
      }),
    ).toEqual([]);
    expect(deadLetterQueue.get(deadLetter.id)?.status).toBe("open");

    const repairedAtMs = Date.parse(repair.metadata.authorityRepair!.repairedAt);
    const subsequent = runtimeHealthAuditRun({
      id: "2026-07-30T06-00-00-000Z-runtime-health-auditor-subsequent",
      status: "success",
      startedAt: new Date(repairedAtMs + 1).toISOString(),
      completedAt: new Date(repairedAtMs + 2).toISOString(),
    });
    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: subsequent,
      }),
    ).toEqual([deadLetter.id]);
    expect(deadLetterQueue.get(deadLetter.id)).toMatchObject({
      status: "dismissed",
      dismissalReason:
        `Superseded by successful run ${subsequent.id} after metadata authority repair ${historicalRunId}`,
    });
  });

  it("keeps unrelated local execution failures open after a later audit succeeds", () => {
    const failed = runtimeHealthAuditRun({
      id: "2026-07-30T03-00-00-000Z-runtime-health-auditor-local",
      status: "failed",
      startedAt: "2026-07-30T03:00:00.000Z",
      completedAt: "2026-07-30T03:01:00.000Z",
    });
    failed.steps[0]!.error = "Runtime health audit collector crashed";
    persistRun(failed);
    const deadLetter = createWorkflowDispatchDeadLetter({
      store: deadLetterQueue,
      scopeId: "scope-a",
      workflowName: failed.workflow,
      trigger: failed.trigger,
      reason: failed.steps[0]!.error!,
      errorClass: "execution",
      failedRun: failed,
    });
    const successful = runtimeHealthAuditRun({
      id: "2026-07-30T04-00-00-000Z-runtime-health-auditor-unrelated",
      status: "success",
      startedAt: "2026-07-30T04:00:00.000Z",
      completedAt: "2026-07-30T04:01:00.000Z",
    });

    expect(
      dismissSupersededWorkflowDeadLetters({
        deadLetterQueue,
        runStore,
        successfulRun: successful,
      }),
    ).toEqual([]);
    expect(deadLetterQueue.get(deadLetter.id)?.status).toBe("open");
  });
});
