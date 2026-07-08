import { sep } from "node:path";
import { fileURLToPath } from "node:url";

export type WorkflowStateRecoveryCliEntrypoint = "source" | "package";

export function resolveWorkflowStateRecoveryCliEntrypoint(
  moduleUrl: string = import.meta.url,
): WorkflowStateRecoveryCliEntrypoint {
  const path = fileURLToPath(moduleUrl);
  return path.includes(`${sep}src${sep}`) ? "source" : "package";
}

export function workflowStateRecoveryCommandPrefix(
  entrypoint: WorkflowStateRecoveryCliEntrypoint = resolveWorkflowStateRecoveryCliEntrypoint(),
): string {
  return entrypoint === "source" ? "pnpm dev" : "pnpm kota";
}

export function workflowStateRecoveryListCommand(
  entrypoint: WorkflowStateRecoveryCliEntrypoint = resolveWorkflowStateRecoveryCliEntrypoint(),
): string {
  return `${workflowStateRecoveryCommandPrefix(entrypoint)} workflow state-recovery list`;
}

export function workflowStateRecoveryResolveCommand(
  taskId: string,
  entrypoint: WorkflowStateRecoveryCliEntrypoint = resolveWorkflowStateRecoveryCliEntrypoint(),
): string {
  return `${workflowStateRecoveryCommandPrefix(entrypoint)} workflow state-recovery resolve ${taskId} --action <release|supersede> --reason "<reason>"`;
}
