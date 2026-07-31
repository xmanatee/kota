import { isWorkflowGateApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowStepContext } from "../run-types.js";
import type { WorkflowApprovalStep } from "../step-types.js";
import type { WorkflowStepOutput } from "./step-executor-agent.js";

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      return;
    }
    const handle = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(handle);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    }, { once: true });
  });
}

export async function executeApprovalStep(
  step: WorkflowApprovalStep,
  context: WorkflowStepContext,
  signal: AbortSignal,
): Promise<WorkflowStepOutput> {
  const label = `workflow "${context.workflow.name}" step "${step.id}"`;
  const queue = context.approvalQueue;
  if (!queue) {
    throw new Error(`${label} has no approval queue for its execution scope`);
  }
  const reason = step.reason ?? `Workflow step "${step.id}" requires approval to continue`;

  const approval = queue.enqueueWorkflowGate({
    workflowName: context.workflow.name,
    runId: context.workflow.runId,
    stepId: step.id,
    reason,
    ...(step.timeoutMs !== undefined && { timeoutMs: step.timeoutMs }),
    ...(step.defaultResolution !== undefined && {
      defaultResolution: step.defaultResolution,
    }),
  });

  let resolved = false;
  try {
    while (true) {
      if (signal.aborted) {
        throw new Error(`${label} was aborted`);
      }

      const current = queue.getWithAuthenticatedResolution(approval.id);
      if (!current) {
        throw new Error(`${label}: approval record ${approval.id} disappeared from queue`);
      }
      if (
        !isWorkflowGateApproval(current)
        || current.input.workflowName !== approval.input.workflowName
        || current.input.runId !== approval.input.runId
        || current.input.stepId !== approval.input.stepId
      ) {
        throw new Error(
          `${label}: approval record ${approval.id} no longer matches the live workflow gate`,
        );
      }

      if (current.status === "approved") {
        resolved = true;
        if (current.resolutionSource === "timeout") {
          const text = `Approval auto-approved: workflow "${context.workflow.name}" step "${step.id}"${step.reason ? ` — ${step.reason}` : ""}`;
          context.emit("workflow.approval.expired", {
            workflowName: context.workflow.name,
            runId: context.workflow.runId,
            stepId: step.id,
            resolution: "approve",
            ...(step.reason !== undefined && { reason: step.reason }),
            text,
          });
        }
        return {
          approvalId: current.id,
          approved: true,
          resolvedAt: current.resolvedAt,
          resolutionSource: current.resolutionSource ?? "human",
          ...(current.approvalNote && { approvalNote: current.approvalNote }),
        };
      }

      if (current.status === "rejected" || current.status === "expired") {
        resolved = true;
        if (current.resolutionSource === "timeout") {
          const text = `Approval auto-denied: workflow "${context.workflow.name}" step "${step.id}"${step.reason ? ` — ${step.reason}` : ""}`;
          context.emit("workflow.approval.expired", {
            workflowName: context.workflow.name,
            runId: context.workflow.runId,
            stepId: step.id,
            resolution: "deny",
            ...(step.reason !== undefined && { reason: step.reason }),
            text,
          });
        }
        const detail = current.rejectionReason ? `: ${current.rejectionReason}` : "";
        throw new Error(`${label} was ${current.status}${detail}`);
      }

      await sleep(POLL_INTERVAL_MS, signal);
    }
  } finally {
    if (!resolved) {
      queue.reject(approval.id, "run aborted");
    }
  }
}
