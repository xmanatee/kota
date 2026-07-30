import { randomUUID } from "node:crypto";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import type { ApprovalMcpPromptDeclaration, PendingApproval } from "./approval-queue-types.js";

let enqueueSequence = 0;

export type PendingApprovalInput = {
	scopeId: string;
	tool: string;
	input: ToolCallInput;
	risk: RiskLevel;
	reason: string;
	source?: string;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	context?: string;
	sessionId?: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
};

export function createPendingApproval(input: PendingApprovalInput): PendingApproval {
	return {
		id: randomUUID().slice(0, 8),
		seq: enqueueSequence++,
		scopeId: input.scopeId,
		tool: input.tool,
		input: input.input,
		risk: input.risk,
		reason: input.reason,
		source: input.source,
		...(input.sessionId !== undefined && { sessionId: input.sessionId }),
		...(input.context !== undefined && { context: input.context }),
		...(input.mcpPromptDeclaration !== undefined && {
			mcpPromptDeclaration: input.mcpPromptDeclaration,
		}),
		createdAt: new Date().toISOString(),
		status: "pending",
		...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
		...(input.defaultResolution !== undefined && { defaultResolution: input.defaultResolution }),
	};
}
