import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ApprovalExecutionDescriptor } from "./approval-execution-descriptor.js";
import type { ApprovalInput } from "./approval-queue.js";
import type {
	ApprovalReviewDescriptor,
	ApprovalReviewUnavailable,
} from "./approval-review-descriptor.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export const WORKFLOW_STEP_APPROVAL_SOURCE = "workflow-step";

export type ApprovalToolIoRedaction = {
	redacted: true;
	reason: "tool-io";
	bytes?: number;
};

export type ApprovalMcpPromptDeclaration = {
	server: string;
	tool: string;
	promptDeclarationFingerprint: string;
	serverTransportIdentityFingerprint: string;
};

export type PendingApproval = {
	id: string;
	seq?: number;
	scopeId: string;
	tool: string;
	input: ApprovalInput;
	risk: RiskLevel;
	reason: string;
	source?: string;
	sessionId?: string;
	/** Last N agent conversation turns captured at enqueue time, for operator context. */
	context?: string;
	contextRedaction?: ApprovalToolIoRedaction;
	createdAt: string;
	status: ApprovalStatus;
	resolvedAt?: string;
	rejectionReason?: string;
	approvalNote?: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	resolutionSource?: string;
};

export function isWorkflowStepApproval(
	approval: Pick<PendingApproval, "source">,
): boolean {
	return approval.source === WORKFLOW_STEP_APPROVAL_SOURCE;
}

export type ApprovalClientProjection = PendingApproval & {
	contextRedaction?: ApprovalToolIoRedaction;
	review: ApprovalReviewDescriptor | ApprovalReviewUnavailable;
};

export type ApprovalExecutionApprovalResult =
	| { ok: true; approval: PendingApproval }
	| {
			ok: false;
			reason: "not_found" | "input_unavailable" | "scope_mismatch" | "descriptor_mismatch";
			approval?: PendingApproval;
	  };

export type ApprovalExecutionApproveAllResult =
	| { ok: true; approvals: PendingApproval[] }
	| {
			ok: false;
			reason: "input_unavailable" | "scope_mismatch" | "descriptor_mismatch";
			approvals: PendingApproval[];
	  };

export type ApprovalExecutionSnapshot = {
	approval: PendingApproval;
	descriptor: ApprovalExecutionDescriptor;
};

export type ApprovalExecutionSnapshotResult =
	| { ok: true; snapshot: ApprovalExecutionSnapshot }
	| {
			ok: false;
			reason: "not_found" | "input_unavailable" | "scope_mismatch";
			approval?: PendingApproval;
	  };

export type SelectedApprovalExecution = ApprovalExecutionSnapshot & {
	executionInput: PendingApproval["input"];
	reviewContext?: string;
};
