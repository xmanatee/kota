import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepErrorKind,
} from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  type BuilderTaskDispatchPayload,
  listBuilderTaskDispatches,
} from "#modules/autonomy/workflows/builder/task-contract.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";

export const FAILED_RUN_ID = "run-failed-builder";
export const TASK_ID = "task-big-refactor";
export function taskMarkdown(
  marker = "Canonical task intent.",
): string {
  const body = renderRepoTaskIntent({
    problem: marker,
    desiredOutcome: "The task can be completed in bounded slices.",
    constraints: "- Preserve the original task intent.",
    howWeWillKnow: "- Each bounded outcome is independently observable.",
    context: "Recover a failed builder run without changing its task target.",
  });
  return `---
status: open
priority: p1
---
# Decompose an exhausted builder task

${body}
`;
}

export const TASK_MARKDOWN = taskMarkdown();

export function prepareTaskProject(workspaceRoot: string): void {
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
}

export function writeActionableTask(
  workspaceRoot: string,
  taskId = TASK_ID,
  marker?: string,
): BuilderTaskDispatchPayload {
  prepareTaskProject(workspaceRoot);
  writeFileSync(
    join(workspaceRoot, "data", "tasks", `${taskId}.md`),
    taskMarkdown(marker),
    "utf8",
  );
  const dispatch = listBuilderTaskDispatches(workspaceRoot).find(
    (candidate) => candidate.taskId === taskId,
  );
  if (dispatch === undefined) {
    throw new Error(`Builder dispatch fixture for ${taskId} is missing`);
  }
  return dispatch;
}

export function immutableTaskPayload(
  taskId: string,
  digest = "a".repeat(64),
): BuilderTaskDispatchPayload {
  return {
    taskId,
    taskPath: `data/tasks/${taskId}.md`,
    taskState: "open",
    taskDigest: digest,
    title: "Immutable task target",
    priority: "p1",
    dependsOn: [],
    idempotencyKey: `builder:${taskId}:${digest}`,
  };
}

export function failedBuilderMetadata(
  task: BuilderTaskDispatchPayload,
  options: {
    errorKind?: WorkflowStepErrorKind;
    error?: string;
    durationMs?: number;
  } = {},
): WorkflowRunMetadata {
  const durationMs = options.durationMs ?? 10 * 60 * 1000;
  return {
    id: FAILED_RUN_ID,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { ...task },
    },
    startedAt: "2026-08-25T00:00:00.000Z",
    completedAt: "2026-08-25T00:10:00.000Z",
    status: "failed",
    durationMs,
    runDir: `.kota/runs/${FAILED_RUN_ID}`,
    steps: [
      {
        id: "build",
        type: "agent",
        status: "failed",
        startedAt: "2026-08-25T00:00:00.000Z",
        completedAt: "2026-08-25T00:10:00.000Z",
        durationMs,
        usage: UNKNOWN_AGENT_USAGE,
        error: options.error,
        errorKind: options.errorKind,
      },
    ],
  };
}

export function writeRunMetadata(
  workspaceRoot: string,
  sourceRunId: string,
  metadata: WorkflowRunMetadata,
): string {
  const stateDir = join(workspaceRoot, ".kota");
  const runDir = join(stateDir, "runs", sourceRunId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  return stateDir;
}

export function failedBuilderTrigger(
  runId = FAILED_RUN_ID,
): WorkflowRunTrigger {
  return {
    event: "workflow.completed",
    schemaRef: null,
    payload: {
      workflow: "builder",
      runId,
      status: "failed",
      runDir: `.kota/runs/${runId}`,
    },
  };
}
