import { getGlobalConfigPath } from "#core/config/config.js";
import type { ToolCallExecutionOptions } from "#core/tools/tool-runner.js";
import { agentHarnessToolRunnerContext } from "./session-context.js";
import type { AgentHarnessRunOptions } from "./types.js";

export type AgentHarnessToolExecutionOverrides = {
	resultLimit: number;
	cwd?: string;
	signal?: AbortSignal;
};

/**
 * Project neutral harness options onto the shared permissioned tool runner.
 * KOTA-hosted adapters add only wire-specific context such as MCP declarations
 * or transcript messages; authorization and execution policy stay identical.
 */
export function agentHarnessToolExecutionOptions(
	options: AgentHarnessRunOptions,
	overrides: AgentHarnessToolExecutionOverrides,
): ToolCallExecutionOptions {
	const toolRunnerContext = agentHarnessToolRunnerContext(options);
	const cwd = overrides.cwd !== undefined ? overrides.cwd : options.cwd;
	const signal = overrides.signal ?? options.abortController?.signal;
	return {
		resultLimit: overrides.resultLimit,
		verbose: options.verbose === true,
		autonomyMode: options.autonomyMode ?? "autonomous",
		...(options.approvalQueue !== undefined
			? { approvalQueue: options.approvalQueue }
			: {}),
		...(options.guardrailsConfig !== undefined
			? { guardrailsConfig: options.guardrailsConfig }
			: {}),
		...(options.scopePolicy !== undefined
			? { scopePolicy: options.scopePolicy }
			: {}),
		...(options.getScopePolicySnapshot !== undefined
			? { getScopePolicySnapshot: options.getScopePolicySnapshot }
			: {}),
		...(options.clientApprovalResolver !== undefined
			? { clientApprovalResolver: options.clientApprovalResolver }
			: {}),
		...(toolRunnerContext.sessionId !== undefined
			? { sessionId: toolRunnerContext.sessionId }
			: {}),
		...(cwd !== undefined ? { cwd } : {}),
		...(options.env !== undefined ? { env: options.env } : {}),
		authorityConfigPath: options.authorityConfigPath ?? getGlobalConfigPath(),
		...(toolRunnerContext.workflow !== undefined
			? { workflowContext: toolRunnerContext.workflow }
			: {}),
		...(toolRunnerContext.scopeId !== undefined
			? { scopeId: toolRunnerContext.scopeId }
			: {}),
		...(toolRunnerContext.projectId !== undefined
			? { projectId: toolRunnerContext.projectId }
			: {}),
		...(options.idempotencyStore !== undefined
			? { idempotencyStore: options.idempotencyStore }
			: {}),
		...(options.tokenBudget !== undefined
			? { tokenBudget: options.tokenBudget }
			: {}),
		...(signal !== undefined ? { signal } : {}),
		...(options.canUseTool !== undefined
			? { canUseTool: options.canUseTool }
			: {}),
		...(options.allowedTools !== undefined
			? { allowedTools: options.allowedTools }
			: {}),
		...(options.disallowedTools !== undefined
			? { disallowedTools: options.disallowedTools }
			: {}),
	};
}
