import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { RiskLevel } from "./guardrails.js";
import type { ValidatedToolCallInput } from "./tool-input-validation.js";
import { mcpPromptDeclarationForApproval } from "./tool-runner-mcp.js";
import type { McpPromptToolDeclarationFingerprints } from "./tool-runner-types.js";

export function enqueueToolApproval(args: {
	approvalQueue?: ApprovalQueue;
	toolName: string;
	input: ValidatedToolCallInput;
	risk: RiskLevel;
	reason: string;
	sessionId?: string | undefined;
	timeoutMs?: number | undefined;
	context?: string | undefined;
	mcpManager?: McpManager | undefined;
	promptFingerprints?: McpPromptToolDeclarationFingerprints | undefined;
}): { id: string } {
	if (!args.approvalQueue) {
		throw new Error(
			"Tool approval queue is unavailable for this execution scope",
		);
	}
	const mcpPromptDeclaration = mcpPromptDeclarationForApproval(
		args.toolName,
		args.mcpManager,
		args.promptFingerprints,
	);
	return args.approvalQueue.enqueue(
		args.toolName,
		args.input,
		args.risk,
		args.reason,
		args.sessionId,
		args.timeoutMs,
		undefined,
		args.context,
		args.sessionId,
		...(mcpPromptDeclaration ? [mcpPromptDeclaration] : []),
	);
}
