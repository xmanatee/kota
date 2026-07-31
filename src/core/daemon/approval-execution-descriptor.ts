import { createHash } from "node:crypto";
import type {
	ApprovalKind,
	ApprovalLocalToolDeclaration,
	ApprovalMcpPromptDeclaration,
	PendingApproval,
} from "./approval-queue.js";
import { createApprovalReviewDescriptor } from "./approval-review-descriptor.js";

export type ApprovalExecutionDescriptor = {
	approvalId: string;
	kind: ApprovalKind;
	tool: string;
	scopeId: string;
	sessionId?: string;
	inputDigest: string;
	reviewDigest: string;
	approvalSnapshotDigest: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
	localToolDeclaration?: ApprovalLocalToolDeclaration;
};

function digestJson(value: PendingApproval | PendingApproval["input"]): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mcpDeclarationsMatch(
	left: ApprovalMcpPromptDeclaration | undefined,
	right: ApprovalMcpPromptDeclaration | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	return (
		left.server === right.server
		&& left.tool === right.tool
		&& left.promptDeclarationFingerprint === right.promptDeclarationFingerprint
		&& left.serverTransportIdentityFingerprint
			=== right.serverTransportIdentityFingerprint
	);
}

function localToolDeclarationsMatch(
	left: ApprovalLocalToolDeclaration | undefined,
	right: ApprovalLocalToolDeclaration | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	return left.registrationGeneration === right.registrationGeneration
		&& left.declarationEffectFingerprint
			=== right.declarationEffectFingerprint;
}

export function createApprovalExecutionDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
	context?: string,
): ApprovalExecutionDescriptor {
	return {
		approvalId: approval.id,
		kind: approval.kind,
		tool: approval.tool,
		scopeId: approval.scopeId,
		...(approval.sessionId !== undefined ? { sessionId: approval.sessionId } : {}),
		inputDigest: digestJson(input),
		reviewDigest: createApprovalReviewDescriptor(approval, input, context).digest,
		approvalSnapshotDigest: digestJson(approval),
		...(approval.mcpPromptDeclaration !== undefined
			? { mcpPromptDeclaration: { ...approval.mcpPromptDeclaration } }
			: {}),
		...(approval.localToolDeclaration !== undefined
			? { localToolDeclaration: { ...approval.localToolDeclaration } }
			: {}),
	};
}

function approvalFieldsMatchDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
	context: string | undefined,
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.id === descriptor.approvalId
		&& approval.kind === descriptor.kind
		&& approval.tool === descriptor.tool
		&& approval.scopeId === descriptor.scopeId
		&& approval.sessionId === descriptor.sessionId
		&& digestJson(input) === descriptor.inputDigest
		&& createApprovalReviewDescriptor(approval, input, context).digest
			=== descriptor.reviewDigest
		&& mcpDeclarationsMatch(
			approval.mcpPromptDeclaration,
			descriptor.mcpPromptDeclaration,
		)
		&& localToolDeclarationsMatch(
			approval.localToolDeclaration,
			descriptor.localToolDeclaration,
		)
	);
}

export function pendingApprovalMatchesExecutionDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
	context: string | undefined,
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.status === "pending"
		&& approvalFieldsMatchDescriptor(approval, input, context, descriptor)
		&& digestJson(approval) === descriptor.approvalSnapshotDigest
	);
}

export function approvedApprovalMatchesExecutionDescriptor(
	approval: PendingApproval,
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.status === "approved"
		&& approvalFieldsMatchDescriptor(approval, approval.input, approval.context, descriptor)
	);
}
