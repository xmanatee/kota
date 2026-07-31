import { randomUUID } from "node:crypto";
import type { RiskLevel } from "#core/tools/guardrails.js";
import type { ToolCallInput } from "#core/tools/guardrails-classify.js";
import type {
	ApprovalLocalToolDeclaration,
	ApprovalMcpPromptDeclaration,
	PendingApproval,
	WorkflowGateApprovalInput,
} from "./approval-queue-types.js";

let enqueueSequence = 0;

type PendingApprovalInputBase = {
	scopeId: string;
	tool: string;
	risk: RiskLevel;
	reason: string;
	source?: string;
	timeoutMs?: number;
	defaultResolution?: "deny" | "approve";
	context?: string;
	sessionId?: string;
	mcpPromptDeclaration?: ApprovalMcpPromptDeclaration;
	localToolDeclaration?: ApprovalLocalToolDeclaration;
};

export type PendingToolApprovalInput = PendingApprovalInputBase & {
	kind: "tool_call";
	input: ToolCallInput;
};

export type PendingWorkflowGateApprovalInput = PendingApprovalInputBase & {
	kind: "workflow_gate";
	input: WorkflowGateApprovalInput;
	source: "workflow-step";
};

export type PendingApprovalInput =
	| PendingToolApprovalInput
	| PendingWorkflowGateApprovalInput;

export function createPendingApproval(input: PendingApprovalInput): PendingApproval {
	return {
		id: randomUUID().slice(0, 8),
		seq: enqueueSequence++,
		scopeId: input.scopeId,
		kind: input.kind,
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
		...(input.localToolDeclaration !== undefined && {
			localToolDeclaration: input.localToolDeclaration,
		}),
		createdAt: new Date().toISOString(),
		status: "pending",
		...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
		...(input.defaultResolution !== undefined && { defaultResolution: input.defaultResolution }),
	};
}
