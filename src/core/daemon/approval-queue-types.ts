import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import type { ApprovalExecutionDescriptor } from "./approval-execution-descriptor.js";
import type {
	ApprovalReviewDescriptor,
	ApprovalReviewUnavailable,
} from "./approval-review-descriptor.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export const WORKFLOW_STEP_APPROVAL_SOURCE = "workflow-step";
export const WORKFLOW_GATE_TOOL_PREFIX = "workflow-approval/";
export type ApprovalKind = "tool_call" | "workflow_gate";

export function usesWorkflowGateIdentity(tool: string, source?: string): boolean {
	return source === WORKFLOW_STEP_APPROVAL_SOURCE
		|| tool.startsWith(WORKFLOW_GATE_TOOL_PREFIX);
}

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

export type ApprovalLocalToolDeclaration = {
	registrationGeneration: number;
	declarationEffectFingerprint: string;
};

export type WorkflowGateApprovalInput = {
	workflowName: string;
	runId: string;
	stepId: string;
};

export type PendingApproval = {
	id: string;
	seq?: number;
	scopeId: string;
	kind: ApprovalKind;
	tool: string;
	input: ToolCallInput;
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
	localToolDeclaration?: ApprovalLocalToolDeclaration;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	resolutionSource?: string;
};

export type PendingToolApproval = PendingApproval & {
	kind: "tool_call";
};

export type PendingWorkflowGateApproval = PendingApproval & {
	kind: "workflow_gate";
	input: WorkflowGateApprovalInput;
	source: typeof WORKFLOW_STEP_APPROVAL_SOURCE;
};

export function isWorkflowGateApproval(
	approval: PendingApproval,
): approval is PendingWorkflowGateApproval {
	return approval.kind === "workflow_gate";
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
	executionInput: PendingApproval["input"];
};

export type ApprovalExecutionSnapshotResult =
	| { ok: true; snapshot: ApprovalExecutionSnapshot }
	| {
			ok: false;
			reason:
				| "not_found"
				| "input_unavailable"
				| "scope_mismatch"
				| "descriptor_mismatch";
			approval?: PendingApproval;
	  };
