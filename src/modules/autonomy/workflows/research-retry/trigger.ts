import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { REPO_TASK_STATES } from "#modules/repo-tasks/repo-tasks-domain.js";

export const RESEARCH_RETRY_EVENT = "autonomy.blocked-research.attemptable";
function isNonNegativeInteger(
  value: WorkflowRunTrigger["payload"][string],
): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasValidQueueCounts(
  value: WorkflowRunTrigger["payload"][string],
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    REPO_TASK_STATES.every((key) => isNonNegativeInteger(Reflect.get(value, key)))
  );
}

export function assertResearchRetryTrigger(trigger: WorkflowRunTrigger): void {
  if (trigger.event !== RESEARCH_RETRY_EVENT) {
    throw new Error(`Research-retry accepts only ${RESEARCH_RETRY_EVENT} triggers`);
  }
  const { scopeId, candidateCount, attemptableCount, counts } = trigger.payload;
  if (
    typeof scopeId !== "string" ||
    scopeId.length === 0 ||
    !isNonNegativeInteger(candidateCount) ||
    !isNonNegativeInteger(attemptableCount) ||
    attemptableCount === 0 ||
    attemptableCount > candidateCount ||
    !hasValidQueueCounts(counts)
  ) {
    throw new Error(
      `Research-retry trigger payload must match ${RESEARCH_RETRY_EVENT}`,
    );
  }
}

