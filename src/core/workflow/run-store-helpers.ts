import { type AutonomyMode, isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { JsonFileError } from "#core/util/json-file.js";
import { readRepairIterations } from "./repair-iteration-output.js";
import type {
  WorkflowCompletion,
  WorkflowQueuedRun,
  WorkflowRecoveryState,
  WorkflowRunMetadata,
  WorkflowRunRef,
  WorkflowRunStatus,
  WorkflowRuntimeState,
  WorkflowStateEntry,
  WorkflowStepSkipReason,
} from "./run-types.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowRunTrigger,
  WorkflowStep,
} from "./types.js";

export const STATE_FILE = "workflow-state.json";

export type WorkflowSnapshot = {
  name: string;
  description?: string;
  enabled: boolean;
  definitionPath: string;
  defaultAutonomyMode?: AutonomyMode;
  triggers: WorkflowDefinition["triggers"];
  steps: Array<Record<string, unknown>>;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return (
    value === "success" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed-with-warnings"
  );
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkflowRunRef(value: unknown): value is WorkflowRunRef {
  return (
    isPlainObject(value) &&
    isIsoString(value.runId) &&
    isIsoString(value.startedAt)
  );
}

function isWorkflowCompletion(value: unknown): value is WorkflowCompletion {
  return (
    isPlainObject(value) &&
    isIsoString(value.runId) &&
    isIsoString(value.startedAt) &&
    isIsoString(value.completedAt) &&
    isWorkflowRunStatus(value.status)
  );
}

/**
 * Convert a legacy per-workflow entry (lastRunId/lastStartedAt/lastCompletedAt/
 * lastStatus flat fields) into the discriminated {lastStarted, lastCompletion}
 * shape. Returns `null` when the entry does not appear to be legacy, so callers
 * can short-circuit without touching already-migrated files.
 *
 * Legacy conflated two different runs into one entry when a run was active:
 * lastRunId/lastStartedAt pointed to the running run while lastCompletedAt/
 * lastStatus carried an older completion. Migration resolves that ambiguity by
 * checking activeRuns: a run that is still active only contributes lastStarted,
 * and the stale completion fields are dropped rather than falsely attributed.
 */
function migrateLegacyWorkflowEntry(
  entry: Record<string, unknown>,
  activeRunIds: ReadonlySet<string>,
): WorkflowStateEntry | null {
  const hasLegacyField =
    "lastRunId" in entry ||
    "lastStartedAt" in entry ||
    "lastCompletedAt" in entry ||
    "lastStatus" in entry;
  if (!hasLegacyField) return null;

  const migrated: WorkflowStateEntry = {};
  if (typeof entry.nextScheduledAt === "string" && entry.nextScheduledAt.trim()) {
    migrated.nextScheduledAt = entry.nextScheduledAt;
  }

  const lastRunId = typeof entry.lastRunId === "string" ? entry.lastRunId : null;
  const lastStartedAt = typeof entry.lastStartedAt === "string" ? entry.lastStartedAt : null;
  const lastCompletedAt = typeof entry.lastCompletedAt === "string" ? entry.lastCompletedAt : null;
  const lastStatus = isWorkflowRunStatus(entry.lastStatus) ? entry.lastStatus : null;

  if (lastRunId && lastStartedAt) {
    migrated.lastStarted = { runId: lastRunId, startedAt: lastStartedAt };
  }

  const runIsActive = lastRunId !== null && activeRunIds.has(lastRunId);
  if (
    !runIsActive &&
    lastRunId &&
    lastStartedAt &&
    lastCompletedAt &&
    lastStatus
  ) {
    migrated.lastCompletion = {
      runId: lastRunId,
      startedAt: lastStartedAt,
      completedAt: lastCompletedAt,
      status: lastStatus,
    };
  }

  return migrated;
}

/**
 * Migrate legacy per-workflow entries in a parsed state object in place.
 * Returns true when at least one entry was rewritten.
 */
export function migrateLegacyWorkflowState(raw: Record<string, unknown>): boolean {
  const workflows = raw.workflows;
  if (!isPlainObject(workflows)) return false;

  const activeRunIds = new Set<string>();
  if (Array.isArray(raw.activeRuns)) {
    for (const run of raw.activeRuns) {
      if (isPlainObject(run) && typeof run.runId === "string") {
        activeRunIds.add(run.runId);
      }
    }
  }

  let changed = false;
  for (const [name, entry] of Object.entries(workflows)) {
    if (!isPlainObject(entry)) continue;
    const migrated = migrateLegacyWorkflowEntry(entry, activeRunIds);
    if (migrated !== null) {
      workflows[name] = migrated;
      changed = true;
    }
  }
  return changed;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkflowCompletedQueuedPayload(value: Record<string, unknown>): boolean {
  return (
    typeof value.workflow === "string" &&
    value.workflow.trim().length > 0 &&
    typeof value.runId === "string" &&
    value.runId.trim().length > 0 &&
    isWorkflowRunStatus(value.status) &&
    typeof value.triggerEvent === "string" &&
    value.triggerEvent.trim().length > 0 &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    typeof value.definitionPath === "string" &&
    value.definitionPath.trim().length > 0 &&
    typeof value.runDir === "string" &&
    value.runDir.trim().length > 0 &&
    isStringArray(value.tags) &&
    (
      value.failureKind === undefined ||
      value.failureKind === "rate_limit" ||
      value.failureKind === "auth" ||
      value.failureKind === "provider"
    ) &&
    (value.autonomyMode === undefined || isAutonomyMode(value.autonomyMode))
  );
}

function isWorkflowStepSkipReason(value: unknown): value is WorkflowStepSkipReason {
  return (
    isPlainObject(value) &&
    (
      value.kind === "when-predicate" ||
      value.kind === "branch-arm-not-taken" ||
      value.kind === "parent-skipped" ||
      value.kind === "foreach-empty"
    ) &&
    (value.label === undefined || typeof value.label === "string")
  );
}

function assertWorkflowStepResult(path: string, value: unknown): void {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.completedAt !== "string" ||
    typeof value.durationMs !== "number"
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata has invalid step result");
  }
  if (
    value.status !== "success" &&
    value.status !== "failed" &&
    value.status !== "skipped"
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata has invalid step status");
  }
  if (value.status === "skipped") {
    if (!isWorkflowStepSkipReason(value.skipReason)) {
      throw new JsonFileError(path, "parse", "skipped workflow step is missing a valid skipReason");
    }
    return;
  }
  if (value.skipReason !== undefined) {
    throw new JsonFileError(path, "parse", "non-skipped workflow step must not include skipReason");
  }
}

function isWorkflowAgentBackoffState(
  value: unknown,
): value is WorkflowAgentBackoffState {
  return (
    isPlainObject(value) &&
    (value.kind === "rate_limit" ||
      value.kind === "auth" ||
      value.kind === "provider") &&
    typeof value.failureCount === "number" &&
    Number.isInteger(value.failureCount) &&
    value.failureCount > 0 &&
    typeof value.until === "string" &&
    value.until.trim().length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0 &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  );
}

function isWorkflowRunTrigger(value: unknown): value is WorkflowRunTrigger {
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    isPlainObject(value.payload)
  );
}

function isQueuedRunTrigger(value: unknown): value is WorkflowRunTrigger {
  if (!isWorkflowRunTrigger(value)) return false;
  if (value.event === "workflow.completed") {
    return isWorkflowCompletedQueuedPayload(value.payload);
  }
  return true;
}

function isQueuedRun(value: unknown): value is WorkflowQueuedRun {
  return (
    isPlainObject(value) &&
    typeof value.workflowName === "string" &&
    isQueuedRunTrigger(value.trigger) &&
    Number.isFinite(value.enqueuedAtMs) &&
    Number.isFinite(value.notBeforeMs)
  );
}

function isRetryAttempt(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.workflow === "string" &&
    typeof value.runId === "string" &&
    typeof value.attemptedAt === "string"
  );
}

function isWorkflowRecoveryState(
  value: unknown,
): value is WorkflowRecoveryState {
  return (
    isPlainObject(value) &&
    typeof value.sourceRunId === "string" &&
    value.sourceRunId.trim().length > 0 &&
    typeof value.sourceWorkflow === "string" &&
    value.sourceWorkflow.trim().length > 0 &&
    typeof value.worktreeFingerprint === "string" &&
    typeof value.worktreeSummary === "string" &&
    typeof value.attempts === "number" &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0 &&
    Array.isArray(value.retryAttemptedBy) &&
    value.retryAttemptedBy.every(isRetryAttempt) &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0
  );
}

export function assertWorkflowRuntimeState(
  path: string,
  value: unknown,
): asserts value is WorkflowRuntimeState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow state shape");
  }
  const completedRuns = value.completedRuns;
  if (
    typeof completedRuns !== "number" ||
    !Number.isInteger(completedRuns) ||
    completedRuns < 0
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state missing completedRuns",
    );
  }
  if (
    !Array.isArray(value.pendingRuns) ||
    value.pendingRuns.some((item) => !isQueuedRun(item))
  ) {
    throw new JsonFileError(path, "parse", "workflow state has invalid pendingRuns");
  }
  if (!isPlainObject(value.workflows)) {
    throw new JsonFileError(path, "parse", "workflow state has invalid workflows");
  }
  if (
    value.agentBackoff !== undefined &&
    !isWorkflowAgentBackoffState(value.agentBackoff)
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state has invalid agentBackoff",
    );
  }
  if (
    value.recovery !== undefined &&
    !isWorkflowRecoveryState(value.recovery)
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state has invalid recovery",
    );
  }
  for (const [workflowName, entry] of Object.entries(value.workflows)) {
    if (!isPlainObject(entry)) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" is invalid`,
      );
    }
    if (entry.lastStarted !== undefined && !isWorkflowRunRef(entry.lastStarted)) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" has invalid lastStarted`,
      );
    }
    if (
      entry.lastCompletion !== undefined &&
      !isWorkflowCompletion(entry.lastCompletion)
    ) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" has invalid lastCompletion`,
      );
    }
    if (
      entry.nextScheduledAt !== undefined &&
      (typeof entry.nextScheduledAt !== "string" || !entry.nextScheduledAt.trim())
    ) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" has invalid nextScheduledAt`,
      );
    }
  }
  if (value.activeRuns !== undefined) {
    if (!Array.isArray(value.activeRuns)) {
      throw new JsonFileError(path, "parse", "workflow state has invalid activeRuns");
    }
    for (const entry of value.activeRuns) {
      if (
        !isPlainObject(entry) ||
        typeof entry.runId !== "string" ||
        typeof entry.workflow !== "string" ||
        typeof entry.startedAt !== "string"
      ) {
        throw new JsonFileError(path, "parse", "workflow state has invalid activeRuns entry");
      }
    }
  }
}

export function assertWorkflowRunMetadata(
  path: string,
  value: unknown,
): asserts value is WorkflowRunMetadata {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow run metadata shape");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.workflow !== "string" ||
    typeof value.definitionPath !== "string" ||
    !isWorkflowRunTrigger(value.trigger) ||
    typeof value.startedAt !== "string" ||
    typeof value.runDir !== "string" ||
    !Array.isArray(value.steps)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata is incomplete");
  }
  if (
    value.status !== "running" &&
    !isWorkflowRunStatus(value.status)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata has invalid status");
  }
  for (const step of value.steps) {
    assertWorkflowStepResult(path, step);
  }
}

export {
  ensureDir,
  formatRunId,
  safeJsonStringify,
  writeJsonFile,
  writeStrictJsonFile,
} from "./run-io.js";

function summarizeStep(step: WorkflowStep): Record<string, unknown> {
  if (step.type === "tool") {
    return {
      id: step.id,
      type: step.type,
      tool: step.tool,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "agent") {
    return {
      id: step.id,
      type: step.type,
      promptPath: step.promptPath,
      model: step.model,
      effort: step.effort,
      maxTurns: step.maxTurns,
      autonomyMode: step.autonomyMode,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      ...(step.harnessOptions ? { harnessOptions: step.harnessOptions } : {}),
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "emit") {
    return {
      id: step.id,
      type: step.type,
      event: step.event,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "restart") {
    return {
      id: step.id,
      type: step.type,
      requires: step.requires,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
      ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
    };
  }
  if (step.type === "parallel") {
    return {
      id: step.id,
      type: step.type,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
  }
  return {
    id: step.id,
    type: step.type,
    ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    ...(step.exposeOutputToAgent ? { exposeOutputToAgent: true } : {}),
  };
}

export type RepairSummary = {
  attempts: number;
  failedChecksByAttempt: string[][];
  totalCostUsd: number;
};

export function extractRepairSummary(output: unknown): RepairSummary | null {
  const iterations = readRepairIterations(output);
  if (iterations.length === 0) return null;
  let totalCostUsd = 0;
  const failedChecksByAttempt: string[][] = [];
  for (const iter of iterations) {
    failedChecksByAttempt.push(iter.failures.map((f) => f.id));
    totalCostUsd += iter.agentCostUsd ?? 0;
  }
  return { attempts: iterations.length, failedChecksByAttempt, totalCostUsd };
}

export function buildWorkflowSnapshot(workflow: WorkflowDefinition): WorkflowSnapshot {
  return {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    definitionPath: workflow.definitionPath,
    defaultAutonomyMode: workflow.defaultAutonomyMode,
    triggers: workflow.triggers,
    steps: workflow.steps.map(summarizeStep),
  };
}
