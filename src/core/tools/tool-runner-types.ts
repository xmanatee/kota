import type {
	KotaJsonObject,
	KotaMessage,
	KotaToolInputSchema,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { AgentCanUseTool } from "#core/agent-harness/run-option-types.js";
import type { AgentTokenBudgetLedger } from "#core/agent-harness/token-budget.js";
import type { AgentHarnessWorkflowContext } from "#core/agent-harness/types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
	ResolvedScopePolicy,
	ScopePolicyAuthority,
	ScopePolicySnapshotAccessor,
} from "#core/daemon/scope-policy.js";
import type { Transport } from "#core/loop/transport.js";
import type {
	McpInputResolver,
	McpManager,
} from "#core/mcp/manager.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import type { GuardrailsConfig } from "./guardrails.js";
import type {
	ToolResult,
	ToolResultBlock,
	ToolRunner,
	ToolRunnerContext,
} from "./index.js";
import type { ToolApprovalResolver } from "./tool-approval.js";
import type { ValidatedToolCallInput } from "./tool-input-validation.js";

export type ToolUseBlock = KotaToolUseBlock;
export type ValidatedToolUseBlock = Omit<KotaToolUseBlock, "input"> & {
	input: ValidatedToolCallInput;
};

export type ToolResultEntry = {
	tool_use_id: string;
	content: string;
	blocks?: ToolResultBlock[];
	structuredContent?: KotaJsonObject;
	_meta?: KotaJsonObject;
	is_error?: boolean;
};

export type McpPromptToolDeclarationFingerprints = ReadonlyMap<string, string>;

export type LocalToolExecutor = (
	name: string,
	input: Parameters<ToolRunner>[0],
	context?: ToolRunnerContext,
) => Promise<ToolResult>;

export type LocalToolExecution = {
	inputSchemas: ReadonlyMap<string, KotaToolInputSchema>;
	execute: LocalToolExecutor;
};

export type ToolCallExecutionOptions = {
	resultLimit: number;
	verbose: boolean;
	autonomyMode: AutonomyMode;
	approvalQueue?: ApprovalQueue;
	mcpManager?: McpManager;
	mcpInputResolver?: McpInputResolver;
	mcpPromptToolDeclarationFingerprints?: McpPromptToolDeclarationFingerprints;
	transport?: Transport;
	guardrailsConfig?: GuardrailsConfig;
	scopePolicy?: ResolvedScopePolicy;
	scopePolicyAuthority?: ScopePolicyAuthority;
	getScopePolicySnapshot?: ScopePolicySnapshotAccessor;
	clientApprovalResolver?: ToolApprovalResolver;
	sessionId?: string;
	cwd?: string;
	env?: Record<string, string>;
	authorityConfigPath?: string;
	workflowContext?: AgentHarnessWorkflowContext;
	scopeId?: string;
	projectId?: string;
	messages?: KotaMessage[];
	idempotencyStore?: IdempotencyStore;
	tokenBudget?: AgentTokenBudgetLedger;
	signal?: AbortSignal;
	canUseTool?: AgentCanUseTool;
	allowedTools?: readonly string[];
	disallowedTools?: readonly string[];
	/** Exact advertised schemas and runner wrappers for a nested hosted loop. */
	localToolExecution?: LocalToolExecution;
};

export type ExecuteToolBlock = (block: ValidatedToolUseBlock) => Promise<ToolResultEntry>;
