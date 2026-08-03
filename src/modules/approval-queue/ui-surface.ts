import type {
  ApprovalClientProjection,
} from "#core/daemon/approval-queue.js";
import type {
  UiAction,
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  shortId,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { ApprovalsListResult } from "./client.js";

function resolutionParameters(
  approval: ApprovalClientProjection,
): UiActionParameterSpec {
  const digest = approval.review.status === "available"
    ? approval.review.digest
    : undefined;
  return {
    fields: [
      { id: "approvalId", label: "Approval id", input: "text", required: true },
      {
        id: "decision",
        label: "Decision",
        input: "select",
        required: true,
        options: [
          { label: "Approve", value: "approve" },
          { label: "Reject", value: "reject" },
        ],
      },
      { id: "reviewDigest", label: "Review digest", input: "text", required: false },
      { id: "note", label: "Decision note", input: "multiline", required: false },
    ],
    schema: {
      type: "object",
      required: ["approvalId", "decision"],
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approve", "reject"] },
        reviewDigest: {
          type: "string",
          ...(digest === undefined ? {} : { default: digest }),
          description: "Approval is bound to this review receipt; it is required when approving.",
        },
        note: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

function resolutionAction(
  scopeId: string,
  approval: ApprovalClientProjection,
): UiAction {
  return action({
    surfaceId: "approvals",
    actionId: `approval.resolve-${approval.id}`,
    scopeId,
    label: "Resolve approval",
    effect: "external",
    operation: { kind: "client-namespace", namespace: "approvals", method: "resolve" },
    parameters: resolutionParameters(approval),
    confirmation: {
      mode: "required",
      title: "Resolve approval",
      detail: "Approving can execute the reviewed tool call. Rejecting denies it without execution.",
      confirmLabel: "Apply decision",
      risk: "high",
    },
    result: resultSpec("Approval resolved."),
  });
}

function approvalDetail(approval: ApprovalClientProjection): string {
  if (approval.review.status !== "available") {
    return `${approval.tool} · ${approval.reason} · review input unavailable after restart; rejection remains available`;
  }
  const input = JSON.stringify(approval.review.input);
  const context = approval.review.context ? ` · context: ${approval.review.context}` : "";
  return `${approval.tool} · ${approval.reason} · input: ${input}${context} · digest: ${approval.review.digest}`;
}

function approvalRows(
  approvals: SurfaceRead<ApprovalsListResult>,
  actions: ReadonlyMap<string, UiAction>,
): UiTableRow[] {
  if (!approvals.ok) return unavailableRows(approvals.message);
  if (approvals.value.approvals.length === 0) return emptyRows("Approvals");
  return approvals.value.approvals.map((approval) => ({
    id: approval.id,
    cells: [
      { columnId: "name", value: shortId(approval.id), role: approval.risk === "dangerous" ? "error" : "warn" },
      { columnId: "state", value: approval.status, role: "warn" },
      { columnId: "detail", value: approvalDetail(approval), role: "muted" },
    ],
    action: actions.get(approval.id),
  }));
}

function buildApprovalsUiSurface(
  scopeId: string,
  approvals: SurfaceRead<ApprovalsListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "approvals",
    actionId: "approvals.list",
    scopeId,
    label: "Reload approvals",
    operation: { kind: "client-namespace", namespace: "approvals", method: "list" },
    result: resultSpec("Approvals loaded."),
  });
  const approvalActions = approvals.ok
    ? approvals.value.approvals.map((approval) => resolutionAction(scopeId, approval))
    : [];
  const actionsById = new Map(
    approvalActions.map((candidate, index) => [approvals.ok ? approvals.value.approvals[index]!.id : "", candidate]),
  );

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "approvals",
    extensionId: "approval-queue.review",
    title: "Approvals",
    intent: "Inbox",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Inbox" },
    order: 24,
    refreshEvents: ["approval.created", "approval.changed", "approval.resolved"],
    permissions: [
      { kind: "capability-scope", scope: "control" },
      { kind: "effect", effect: "external" },
    ],
    nodes: [
      {
        kind: "status-summary",
        entries: [{
          label: "Pending approvals",
          value: readValue(approvals, (value) => `${value.approvals.length}`),
          role: readRole(approvals),
        }],
      },
      {
        kind: "table",
        title: "Pending tool and workflow approvals",
        columns: NAME_STATE_DETAIL_COLUMNS,
        rows: approvalRows(approvals, actionsById),
      },
      { kind: "action-list", title: "Approval actions", actions: [refresh, ...approvalActions] },
    ],
    actions: [refresh, ...approvalActions],
  };
}

export const approvalUiSurfaceSource: UiSurfaceSource = {
  sourceId: "approvals",
  project: async (context) => {
    const approvals = await context.read("approvals", () =>
      context.client.approvals.list({ status: "pending" }),
    );
    return [buildApprovalsUiSurface(context.scopeId, approvals)];
  },
};
