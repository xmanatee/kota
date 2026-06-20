import type { WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowRunTrigger, WorkflowTrigger } from "./trigger-types.js";

export function matchesFilter(
  filter: WorkflowTrigger["filter"],
  payload: WorkflowRunTrigger["payload"],
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    let actual = payloadPathValue(payload, key);
    if (actual === undefined) {
      if (key === "scopeId") actual = payload.projectId;
      if (key === "projectId") actual = payload.scopeId;
    }
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) {
        if (!expected.some((value) => actual.includes(value))) return false;
        continue;
      }
      if (!actual.includes(expected)) return false;
      continue;
    }
    if (Array.isArray(expected)) {
      if (!expected.includes(actual as string | number | boolean)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function payloadPathValue(
  payload: WorkflowRunTrigger["payload"],
  path: string,
): WorkflowRunTrigger["payload"][string] {
  const segments = path.split(".");
  let current: WorkflowRunTrigger["payload"] | WorkflowRunTrigger["payload"][string] =
    payload;
  for (const segment of segments) {
    if (!isPayloadObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPayloadObject(
  value: WorkflowRunTrigger["payload"] | WorkflowRunTrigger["payload"][string],
): value is WorkflowRunTrigger["payload"] {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getEligibleAtMs(
  workflowName: string,
  cooldownMs: number,
  state: WorkflowRuntimeState,
): number {
  const lastCompletedAt = state.workflows[workflowName]?.lastCompletion?.completedAt;
  if (!lastCompletedAt || cooldownMs <= 0) return Date.now();
  return new Date(lastCompletedAt).getTime() + cooldownMs;
}
