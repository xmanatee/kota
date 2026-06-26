import { tryEmit } from "#core/events/event-bus.js";
import type { McpExecuteToolOptions } from "#core/mcp/manager.js";
import { confirmAction } from "#core/util/confirm.js";
import { resolveAutonomyGate } from "./autonomy-mode.js";
import { assess } from "./guardrails.js";
import type { ToolCallInput } from "./guardrails-classify.js";
import type { ToolResult } from "./index.js";
import { executeTool } from "./index.js";
import {
	type ClientApprovalResult,
	extractApprovalContext,
	ToolApprovalCancelledError,
} from "./tool-approval.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { enqueueToolApproval } from "./tool-runner-approval-queue.js";
import { executeToolWithIdempotency } from "./tool-runner-idempotency.js";
import { staleMcpDeclarationResult } from "./tool-runner-mcp.js";
import { recordToolExecutionMetric } from "./tool-runner-metrics.js";
import type {
	ToolCallExecutionOptions,
	ToolResultEntry,
	ToolUseBlock,
} from "./tool-runner-types.js";

function abortReason(signal: AbortSignal): Error {
	const { reason } = signal;
	return reason instanceof Error ? reason : new Error("Tool execution aborted");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortReason(signal);
}

function resultEntry(block: ToolUseBlock, result: ToolResult): ToolResultEntry {
	return {
		tool_use_id: block.id,
		content: result.content,
		...(result.blocks ? { blocks: result.blocks } : {}),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
		...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
	};
}

function errorEntry(block: ToolUseBlock, content: string): ToolResultEntry {
	return { tool_use_id: block.id, content, is_error: true };
}

export async function executeToolBlock(
	block: ToolUseBlock,
	options: ToolCallExecutionOptions,
): Promise<ToolResultEntry> {
	const {
		resultLimit,
		verbose,
		autonomyMode,
		mcpManager,
		mcpInputResolver,
		mcpPromptToolDeclarationFingerprints,
		transport,
		guardrailsConfig,
		clientApprovalResolver,
		sessionId,
		cwd,
		workflowContext,
		scopeId,
		projectId,
		messages,
		idempotencyStore,
		tokenBudget,
		signal,
	} = options;
	throwIfAborted(signal);
	if (verbose && transport) {
		transport.emit({
			type: "status",
			message: `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
		});
	}
	const input = block.input as ToolCallInput;
	const staleResult = staleMcpDeclarationResult(
		block.name,
		mcpManager,
		mcpPromptToolDeclarationFingerprints,
	);
	if (staleResult) {
		recordToolExecutionMetric({ block, input, result: staleResult, resultLimit, transport });
		return resultEntry(block, staleResult);
	}

	const assessment = guardrailsConfig
		? assess(block.name, input, guardrailsConfig)
		: assess(block.name, input);
	const emitGuardrailAssessment = (
		policy: "deny" | "queue" | "allow" | "confirm",
		reason: string,
	): void => {
		tryEmit("guardrail.assessed", {
			tool: assessment.tool,
			risk: assessment.risk,
			policy,
			reason,
			...(sessionId && { session: sessionId }),
		});
		transport?.emit({ type: "guardrail", tool: assessment.tool, risk: assessment.risk, policy, reason });
	};
	const askClientApproval = async (
		reason: string,
		approvalContext: string | undefined,
	): Promise<ClientApprovalResult> => {
		if (!clientApprovalResolver) return { outcome: "unavailable" };
		const decision = await clientApprovalResolver({
			id: block.id,
			toolUseId: block.id,
			toolName: block.name,
			input,
			risk: assessment.risk,
			reason,
			...(sessionId !== undefined ? { sessionId } : {}),
			...(guardrailsConfig?.approvalTimeoutMs !== undefined
				? { timeoutMs: guardrailsConfig.approvalTimeoutMs }
				: {}),
			...(approvalContext !== undefined ? { context: approvalContext } : {}),
			...(signal !== undefined ? { signal } : {}),
		});
		if (decision.outcome === "allow") return { outcome: "allowed" };
		if (decision.outcome === "cancelled") throw new ToolApprovalCancelledError(decision.message);
		return { outcome: "blocked", result: errorEntry(block, `Blocked by client approval: ${decision.message}`) };
	};

	const autonomyDecision = resolveAutonomyGate(autonomyMode, assessment);
	if (autonomyDecision.action === "deny") {
		emitGuardrailAssessment("deny", autonomyDecision.message);
		return errorEntry(block, autonomyDecision.message);
	}
	let clientApprovedAutonomyGate = false;
	if (autonomyDecision.action === "queue") {
		const approvalContext = messages ? extractApprovalContext(messages) : undefined;
		emitGuardrailAssessment("queue", autonomyDecision.reason);
		const clientDecision = await askClientApproval(autonomyDecision.reason, approvalContext);
		if (clientDecision.outcome === "blocked") return clientDecision.result;
		if (clientDecision.outcome === "unavailable") {
			const queued = enqueueToolApproval({
				toolName: block.name,
				input,
				risk: assessment.risk,
				reason: autonomyDecision.reason,
				sessionId,
				timeoutMs: guardrailsConfig?.approvalTimeoutMs,
				context: approvalContext,
				promptFingerprints: mcpPromptToolDeclarationFingerprints,
			});
			return errorEntry(
				block,
				`Queued for approval [${queued.id}]: ${block.name} - ${autonomyDecision.reason}. ` +
					"Operators can review and resolve it through the approval CLI or authenticated daemon client.",
			);
		}
		clientApprovedAutonomyGate = true;
	}

	emitGuardrailAssessment(assessment.policy, assessment.reason);
	if (assessment.policy === "deny") {
		return errorEntry(
			block,
			`Blocked by guardrails: ${block.name} is classified as ${assessment.risk} (${assessment.reason}). ` +
				"This operation requires approval. Use ask_user to request permission, or try a safer approach.",
		);
	}
	if (assessment.policy === "queue" && !clientApprovedAutonomyGate) {
		const approvalContext = messages ? extractApprovalContext(messages) : undefined;
		const clientDecision = await askClientApproval(assessment.reason, approvalContext);
		if (clientDecision.outcome === "blocked") return clientDecision.result;
		if (clientDecision.outcome === "unavailable") {
			const queued = enqueueToolApproval({
				toolName: block.name,
				input,
				risk: assessment.risk,
				reason: assessment.reason,
				sessionId,
				timeoutMs: guardrailsConfig?.approvalTimeoutMs,
				context: approvalContext,
				promptFingerprints: mcpPromptToolDeclarationFingerprints,
			});
			return errorEntry(
				block,
				`Queued for approval [${queued.id}]: ${block.name} is classified as ${assessment.risk} (${assessment.reason}). ` +
					"Operators can review and resolve it through the approval CLI or authenticated daemon client.",
			);
		}
	}
	if (assessment.policy === "confirm") {
		let approved = false;
		if (!clientApprovedAutonomyGate) {
			const approvalContext = messages ? extractApprovalContext(messages) : undefined;
			const clientDecision = await askClientApproval(assessment.reason, approvalContext);
			if (clientDecision.outcome === "blocked") return clientDecision.result;
			approved = clientDecision.outcome === "allowed";
		}
		if (!approved) {
			approved = await confirmAction(`Allow ${block.name}? (${assessment.reason})`);
		}
		if (!approved) {
			return errorEntry(
				block,
				`Blocked by guardrails: ${block.name} requires confirmation (${assessment.reason}). ` +
					"Use ask_user to request explicit human approval, then retry.",
			);
		}
	}

	const startMs = performance.now();
	const runnerContext = {
		...(sessionId && { sessionId }),
		toolUseId: block.id,
		...(cwd !== undefined ? { cwd } : {}),
		...(scopeId !== undefined ? { scopeId } : {}),
		...(projectId !== undefined ? { projectId } : {}),
		...(workflowContext !== undefined
			? {
					workflow: workflowContext,
					scopeId: workflowContext.scopeId,
					projectId: workflowContext.projectId,
				}
			: {}),
		...(tokenBudget !== undefined ? { tokenBudget } : {}),
		...(signal ? { signal } : {}),
	};
	const resultContentProvenance = mcpManager?.getToolResultContentProvenance?.(block.name);
	const call = {
		name: block.name,
		input,
		context: {
			autonomyMode,
			...runnerContext,
			...(resultContentProvenance ? { resultContentProvenance } : {}),
		},
	};
	const baseFn = async () => {
		const dispatchStaleResult = staleMcpDeclarationResult(
			call.name,
			mcpManager,
			mcpPromptToolDeclarationFingerprints,
		);
		if (dispatchStaleResult) return dispatchStaleResult;
		if (!mcpManager?.isMcpTool(call.name)) return executeTool(call.name, call.input, runnerContext);
		const mcpOptions: McpExecuteToolOptions = {};
		if (mcpInputResolver) mcpOptions.inputResolver = mcpInputResolver;
		if (signal) mcpOptions.signal = signal;
		return Object.keys(mcpOptions).length > 0
			? mcpManager.executeTool(call.name, call.input, mcpOptions)
			: mcpManager.executeTool(call.name, call.input);
	};
	const result = await executeToolWithIdempotency(
		block,
		input,
		idempotencyStore,
		() => getToolMiddleware().execute(call, baseFn),
	);
	throwIfAborted(signal);
	recordToolExecutionMetric({
		block,
		input,
		result,
		resultLimit,
		transport,
		resultContentProvenance,
		startMs,
	});
	return resultEntry(block, result);
}
