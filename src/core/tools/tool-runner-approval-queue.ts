import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { RiskLevel } from "./guardrails.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import { mcpPromptDeclarationForApproval } from "./tool-runner-mcp.js";
import type { McpPromptToolDeclarationFingerprints } from "./tool-runner-types.js";

export function enqueueToolApproval(args: {
	toolName: string;
	input: ToolCallInput;
	risk: RiskLevel;
	reason: string;
	sessionId?: string | undefined;
	timeoutMs?: number | undefined;
	context?: string | undefined;
	mcpManager?: McpManager | undefined;
	promptFingerprints?: McpPromptToolDeclarationFingerprints | undefined;
}): { id: string } {
	const mcpPromptDeclaration = mcpPromptDeclarationForApproval(
		args.toolName,
		args.mcpManager,
		args.promptFingerprints,
	);
	return getApprovalQueue().enqueue(
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
