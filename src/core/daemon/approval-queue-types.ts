import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import type { ApprovalExecutionDescriptor } from "./approval-execution-descriptor.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

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
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	resolutionSource?: string;
};

export type ApprovalClientProjection = PendingApproval & {
	contextRedaction?: ApprovalToolIoRedaction;
};

export type ApprovalExecutionApprovalResult =
	| { ok: true; approval: PendingApproval }
	| {
			ok: false;
			reason:
				| "not_found"
				| "input_unavailable"
				| "scope_mismatch"
				| "descriptor_mismatch";
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
