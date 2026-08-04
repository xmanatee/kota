import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import { tryEmit } from "#core/events/event-bus.js";
import type { McpExecuteToolOptions } from "#core/mcp/manager.js";
import { confirmAction } from "#core/util/confirm.js";
import { resolveAutonomyGate } from "./autonomy-mode.js";
import { assess } from "./guardrails.js";
import { executeTool, type ToolResult } from "./index.js";
import {
	type ClientApprovalResult,
	extractApprovalContext,
	ToolApprovalCancelledError,
} from "./tool-approval.js";
import {
	createToolApprovalExecutionBinding,
	snapshotToolCallForExecution,
	type ToolApprovalExecutionBinding,
} from "./tool-approval-execution.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { throwIfToolRunnerAborted } from "./tool-runner-abort.js";
import { enqueueToolApproval } from "./tool-runner-approval-queue.js";
import { executeToolWithIdempotency } from "./tool-runner-idempotency.js";
import { staleMcpDeclarationResult } from "./tool-runner-mcp.js";
import { recordToolExecutionMetric } from "./tool-runner-metrics.js";
import { withToolCallExecutionOptions } from "./tool-runner-runtime.js";
import { enforceToolScopePolicy } from "./tool-runner-scope-policy.js";
import type {
	ToolCallExecutionOptions,
	ToolResultEntry,
	ValidatedToolUseBlock,
} from "./tool-runner-types.js";

function resultEntry(block: ValidatedToolUseBlock, result: ToolResult): ToolResultEntry {
	return {
		tool_use_id: block.id,
		content: result.content,
		...(result.blocks ? { blocks: result.blocks } : {}),
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result._meta ? { _meta: result._meta } : {}),
		...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
	};
}
function errorEntry(block: ValidatedToolUseBlock, content: string): ToolResultEntry {
	return { tool_use_id: block.id, content, is_error: true };
}
export async function executeToolBlock(
	block: ValidatedToolUseBlock,
	options: ToolCallExecutionOptions,
): Promise<ToolResultEntry> {
	const {
		resultLimit,
		verbose,
		autonomyMode,
		approvalQueue,
		mcpManager,
		mcpInputResolver,
		mcpPromptToolDeclarationFingerprints,
		transport,
		guardrailsConfig,
		clientApprovalResolver,
		sessionId,
		cwd,
		env,
		authorityConfigPath,
		workflowContext,
		scopeId,
		projectId,
		messages,
		idempotencyStore,
		tokenBudget,
		signal,
	} = options;
	throwIfToolRunnerAborted(signal);
	if (verbose && transport) {
		transport.emit({
			type: "status",
			message: `[kota] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)}...)`,
		});
	}
	const input = block.input;
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
	let approvalExecutionBinding: ToolApprovalExecutionBinding | undefined;
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
		const binding = createToolApprovalExecutionBinding(block.name, input);
		const decision = await clientApprovalResolver({
			id: block.id,
			toolUseId: block.id,
			toolName: block.name,
			input: binding.reviewedInput,
			risk: assessment.risk,
			reason,
			...(sessionId !== undefined ? { sessionId } : {}),
			...(guardrailsConfig?.approvalTimeoutMs !== undefined
				? { timeoutMs: guardrailsConfig.approvalTimeoutMs }
				: {}),
			...(approvalContext !== undefined ? { context: approvalContext } : {}),
			...(signal !== undefined ? { signal } : {}),
		});
		if (decision.outcome === "allow") {
			approvalExecutionBinding = binding;
			return { outcome: "allowed" };
		}
		if (decision.outcome === "cancelled") throw new ToolApprovalCancelledError(decision.message);
		return { outcome: "blocked", result: errorEntry(block, `Blocked by client approval: ${decision.message}`) };
	};

	// The accessor returns an atomic policy-and-revision pair. Never retain its
	// policy across invocations: a later call must observe a restrictive commit.
	const scopePolicySnapshot = options.getScopePolicySnapshot?.();
	const scopePolicy = scopePolicySnapshot?.policy ?? options.scopePolicy;
	if (scopePolicy) {
		const scopePolicyResult = await enforceToolScopePolicy({
			block,
			options,
			policy: scopePolicy,
			risk: assessment.risk,
			askClientApproval,
			emitAssessment: emitGuardrailAssessment,
		});
		if (scopePolicyResult) return scopePolicyResult;
	}

	const effectiveAutonomyMode = scopePolicy
		? capScopeAutonomyMode(autonomyMode, scopePolicy)
		: autonomyMode;
	const autonomyDecision = resolveAutonomyGate(effectiveAutonomyMode, assessment);
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
				approvalQueue,
				toolName: block.name,
				input,
				risk: assessment.risk,
				reason: autonomyDecision.reason,
				sessionId,
				timeoutMs: guardrailsConfig?.approvalTimeoutMs,
				context: approvalContext,
				mcpManager,
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
				approvalQueue,
				toolName: block.name,
				input,
				risk: assessment.risk,
				reason: assessment.reason,
				sessionId,
				timeoutMs: guardrailsConfig?.approvalTimeoutMs,
				context: approvalContext,
				mcpManager,
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
		...(approvalQueue !== undefined ? { approvalQueue } : {}),
		...(sessionId && { sessionId }),
		toolUseId: block.id,
		...(cwd !== undefined ? { cwd } : {}),
		...(env !== undefined ? { env } : {}),
		...(authorityConfigPath !== undefined ? { authorityConfigPath } : {}),
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
		const executionCall = snapshotToolCallForExecution(call);
		if (approvalExecutionBinding && !approvalExecutionBinding.matches(executionCall)) {
			return {
				content: "Blocked because tool input changed after client approval; request approval for the new operation.",
				is_error: true,
			};
		}
		const dispatchStaleResult = staleMcpDeclarationResult(
			executionCall.name,
			mcpManager,
			mcpPromptToolDeclarationFingerprints,
		);
		if (dispatchStaleResult) return dispatchStaleResult;
		if (!mcpManager?.isMcpTool(executionCall.name)) {
			const executeLocalTool = options.localToolExecution?.execute ?? executeTool;
			return executeLocalTool(executionCall.name, executionCall.input, runnerContext);
		}
		const mcpOptions: McpExecuteToolOptions = {};
		if (mcpInputResolver) mcpOptions.inputResolver = mcpInputResolver;
		if (signal) mcpOptions.signal = signal;
		return Object.keys(mcpOptions).length > 0
			? mcpManager.executeTool(executionCall.name, executionCall.input, mcpOptions)
			: mcpManager.executeTool(executionCall.name, executionCall.input);
	};
	const result = await withToolCallExecutionOptions(options, () =>
		executeToolWithIdempotency(
			block,
			input,
			idempotencyStore,
			() => getToolMiddleware().execute(call, baseFn),
		),
	);
	throwIfToolRunnerAborted(signal);
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
