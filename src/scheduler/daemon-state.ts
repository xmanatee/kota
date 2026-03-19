import { JsonFileError } from "../json-file.js";
import type { WorkflowRunStatus } from "../workflow/types.js";

export type DaemonState = {
  startedAt: string;
  completedRuns: number;
  lastCompletedWorkflow?: string;
  lastCompletedAt?: string;
  lastCompletedStatus?: WorkflowRunStatus;
  pid: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return value === "success" || value === "failed" || value === "interrupted";
}

export function assertDaemonState(path: string, value: unknown): asserts value is DaemonState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid daemon state shape");
  }
  const completedRuns = value.completedRuns;
  const pid = value.pid;
  if (typeof value.startedAt !== "string" || !value.startedAt.trim()) {
    throw new JsonFileError(path, "parse", "daemon state missing startedAt");
  }
  if (
    typeof completedRuns !== "number" ||
    !Number.isInteger(completedRuns) ||
    completedRuns < 0
  ) {
    throw new JsonFileError(path, "parse", "daemon state missing completedRuns");
  }
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new JsonFileError(path, "parse", "daemon state missing pid");
  }
  if (
    value.lastCompletedWorkflow !== undefined &&
    (typeof value.lastCompletedWorkflow !== "string" ||
      !value.lastCompletedWorkflow.trim())
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "daemon state has invalid lastCompletedWorkflow",
    );
  }
  if (
    value.lastCompletedAt !== undefined &&
    (typeof value.lastCompletedAt !== "string" || !value.lastCompletedAt.trim())
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "daemon state has invalid lastCompletedAt",
    );
  }
  if (
    value.lastCompletedStatus !== undefined &&
    !isWorkflowRunStatus(value.lastCompletedStatus)
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "daemon state has invalid lastCompletedStatus",
    );
  }
}
