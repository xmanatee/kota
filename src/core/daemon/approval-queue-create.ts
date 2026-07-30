import { randomUUID } from "node:crypto";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type {
	ApprovalMcpPromptDeclaration,
	PendingApproval,
} from "./approval-queue-types.js";

let enqueueSequence = 0;

export function createPendingApproval(
	scopeId: string,
	tool: string,
	input: PendingApproval["input"],
	risk: RiskLevel,
	reason: string,
	source?: string,
	timeoutMs?: number,
	defaultResolution?: "deny" | "approve",
	context?: string,
	sessionId?: string,
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration,
): PendingApproval {
	return {
		id: randomUUID().slice(0, 8),
		seq: enqueueSequence++,
		scopeId,
		tool,
		input,
		risk,
		reason,
		source,
		...(sessionId !== undefined && { sessionId }),
		...(context !== undefined && { context }),
		...(mcpPromptDeclaration !== undefined && { mcpPromptDeclaration }),
		createdAt: new Date().toISOString(),
		status: "pending",
		...(timeoutMs !== undefined && { timeoutMs }),
		...(defaultResolution !== undefined && { defaultResolution }),
	};
}
