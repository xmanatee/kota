import { createHash } from "node:crypto";
import type {
	ApprovalMcpPromptDeclaration,
	PendingApproval,
} from "./approval-queue.js";

export type ApprovalExecutionDescriptor = {
	approvalId: string;
	tool: string;
	scopeId: string;
	sessionId?: string;
	inputDigest: string;
	approvalSnapshotDigest: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
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

export function createApprovalExecutionDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
): ApprovalExecutionDescriptor {
	return {
		approvalId: approval.id,
		tool: approval.tool,
		scopeId: approval.scopeId,
		...(approval.sessionId !== undefined ? { sessionId: approval.sessionId } : {}),
		inputDigest: digestJson(input),
		approvalSnapshotDigest: digestJson(approval),
		...(approval.mcpPromptDeclaration !== undefined
			? { mcpPromptDeclaration: { ...approval.mcpPromptDeclaration } }
			: {}),
	};
}

function approvalFieldsMatchDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.id === descriptor.approvalId
		&& approval.tool === descriptor.tool
		&& approval.scopeId === descriptor.scopeId
		&& approval.sessionId === descriptor.sessionId
		&& digestJson(input) === descriptor.inputDigest
		&& mcpDeclarationsMatch(
			approval.mcpPromptDeclaration,
			descriptor.mcpPromptDeclaration,
		)
	);
}

export function pendingApprovalMatchesExecutionDescriptor(
	approval: PendingApproval,
	input: PendingApproval["input"],
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.status === "pending"
		&& approvalFieldsMatchDescriptor(approval, input, descriptor)
		&& digestJson(approval) === descriptor.approvalSnapshotDigest
	);
}

export function approvedApprovalMatchesExecutionDescriptor(
	approval: PendingApproval,
	descriptor: ApprovalExecutionDescriptor,
): boolean {
	return (
		approval.status === "approved"
		&& approvalFieldsMatchDescriptor(approval, approval.input, descriptor)
	);
}
