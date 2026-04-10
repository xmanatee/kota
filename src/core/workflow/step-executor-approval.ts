import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { tryEmit } from "#core/events/event-bus.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { WorkflowStepOutput } from "./step-executor-agent.js";
import type { WorkflowApprovalStep } from "./types.js";

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
  const queue = getApprovalQueue();
  const label = `workflow "${context.workflow.name}" step "${step.id}"`;
  const reason = step.reason ?? `Workflow step "${step.id}" requires approval to continue`;

  const approval = queue.enqueue(
    `workflow-approval/${context.workflow.name}/${step.id}`,
    {
      workflowName: context.workflow.name,
      runId: context.workflow.runId,
      stepId: step.id,
      reason,
    },
    "moderate",
    reason,
    "workflow-step",
    step.timeoutMs,
    step.defaultResolution,
  );

  let resolved = false;
  try {
    while (true) {
      if (signal.aborted) {
        throw new Error(`${label} was aborted`);
      }

      const current = queue.get(approval.id);
      if (!current) {
        throw new Error(`${label}: approval record ${approval.id} disappeared from queue`);
      }

      if (current.status === "approved") {
        resolved = true;
        if (current.resolutionSource === "timeout") {
          const text = `Approval auto-approved: workflow "${context.workflow.name}" step "${step.id}"${step.reason ? ` — ${step.reason}` : ""}`;
          tryEmit("workflow.approval.expired", {
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
          tryEmit("workflow.approval.expired", {
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
