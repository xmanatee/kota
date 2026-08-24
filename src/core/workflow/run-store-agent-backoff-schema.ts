import type { WorkflowAgentBackoffState } from "./trigger-types.js";

type PlainObjectPredicate = typeof import("./run-store-state-schema.js").isPlainObject;

export function isWorkflowAgentBackoffState(
  value: Parameters<PlainObjectPredicate>[0],
  isPlainObject: PlainObjectPredicate,
): value is WorkflowAgentBackoffState {
  return (
    isPlainObject(value) &&
    typeof value.runtimeId === "string" &&
    value.runtimeId.trim().length > 0 &&
    (
      value.kind === "rate_limit" ||
      value.kind === "auth" ||
      value.kind === "provider" ||
      value.kind === "runtime"
    ) &&
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
