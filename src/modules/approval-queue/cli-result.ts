import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { line, plain, type RenderNode, span } from "#modules/rendering/primitives.js";
import { safeTerminalLineText } from "#modules/rendering/safe-terminal-text.js";
import { executionRedactionSuffix } from "./cli-support.js";
import type { ApprovalResolutionProjection } from "./client.js";

export function renderApprovalOutcome(
  item: PendingApproval,
  resolution: ApprovalResolutionProjection,
): { node: RenderNode; failed: boolean } {
  const tool = safeTerminalLineText(item.tool);
  if (resolution.kind === "tool_execution" && resolution.execution.status === "failed") {
    return {
      failed: true,
      node: line(span(`Tool execution failed in daemon for [${item.id}] ${tool}${executionRedactionSuffix(resolution.execution)}`, "error")),
    };
  }
  const note = item.approvalNote ? ` — note: ${safeTerminalLineText(item.approvalNote)}` : "";
  const gate = resolution.kind === "workflow_gate_approved";
  const suffix = gate ? "" : executionRedactionSuffix(resolution.execution);
  return {
    failed: false,
    node: line(
      span(gate ? "Approved workflow gate " : "Approved and executed ", "success"),
      plain(`${tool} `),
      span(`[${item.id}]`, "accent"),
      plain(`${note}${suffix}`),
    ),
  };
}

export function renderApprovalRejection(item: PendingApproval, reason?: string): RenderNode {
  return line(
    span("Rejected: ", "error"),
    plain(`${safeTerminalLineText(item.tool)} `),
    span(`[${item.id}]`, "accent"),
    plain(reason ? ` — ${safeTerminalLineText(reason)}` : ""),
  );
}
