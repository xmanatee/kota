import type {
	KotaJsonObject,
	KotaMessage,
	KotaToolUseBlock,
} from "#core/agent-harness/message-protocol.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { Transport } from "#core/loop/transport.js";
import type {
	McpInputResolver,
	McpManager,
} from "#core/mcp/manager.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import type { GuardrailsConfig } from "./guardrails.js";
import type { ToolResultBlock } from "./index.js";
import type { ToolApprovalResolver } from "./tool-approval.js";

export type ToolUseBlock = KotaToolUseBlock;

export type ToolResultEntry = {
	tool_use_id: string;
	content: string;
	blocks?: ToolResultBlock[];
	structuredContent?: KotaJsonObject;
	_meta?: KotaJsonObject;
	is_error?: boolean;
};

export type McpPromptToolDeclarationFingerprints = ReadonlyMap<string, string>;

export type ToolCallExecutionOptions = {
	resultLimit: number;
	verbose: boolean;
	autonomyMode: AutonomyMode;
	mcpManager?: McpManager;
	mcpInputResolver?: McpInputResolver;
	mcpPromptToolDeclarationFingerprints?: McpPromptToolDeclarationFingerprints;
	transport?: Transport;
	guardrailsConfig?: GuardrailsConfig;
	clientApprovalResolver?: ToolApprovalResolver;
	sessionId?: string;
	messages?: KotaMessage[];
	idempotencyStore?: IdempotencyStore;
	signal?: AbortSignal;
};

export type ExecuteToolBlock = (block: ToolUseBlock) => Promise<ToolResultEntry>;
