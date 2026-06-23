import {
	type ApprovalClientProjection,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { projectEvidenceText, redactSensitiveText } from "#core/evidence/policy.js";
import { McpManager } from "#core/mcp/manager.js";
import { parseToolName } from "#core/mcp/tool-namespace.js";
import { executeTool, type ToolRunnerContext } from "#core/tools/index.js";
import { isMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { ApprovalExecutionProjection } from "./client.js";

export type ApprovalExecutionLease = {
	approvalId: string;
	mcpManager?: McpManager;
};

type McpApprovalFailureReason =
	| "mcp_approval_missing_declaration"
	| "mcp_approval_source_mismatch"
	| "mcp_approval_manager_unavailable"
	| "mcp_declaration_changed_since_prompt";

type McpApprovalFailureBody = {
	error: string;
	reason: McpApprovalFailureReason;
	approvals: ApprovalClientProjection[];
	mcp?: {
		tool: string;
		server?: string;
		remoteTool?: string;
		promptDeclarationFingerprintPrefix?: string;
		currentDeclarationFingerprintPrefix?: string | null;
		message?: string;
	};
};

type ApprovalExecutionPreflight =
	| { ok: true; lease: ApprovalExecutionLease }
	| { ok: false; status: 409; body: McpApprovalFailureBody };

export type ApprovalExecutionPreflightBatch =
	| { ok: true; leases: Map<string, ApprovalExecutionLease> }
	| { ok: false; status: 409; body: McpApprovalFailureBody };

const MCP_DECLARATION_CHANGED_REASON = "mcp_declaration_changed_since_prompt";

function approvalExecutionContext(
	base: ToolRunnerContext | undefined,
	item: PendingApproval,
): ToolRunnerContext | undefined {
	if (!base && !item.sessionId) return undefined;
	return {
		...base,
		...(item.sessionId ? { sessionId: item.sessionId } : {}),
	};
}

function mcpFailureBody(
	reason: McpApprovalFailureReason,
	item: PendingApproval,
	detail?: McpApprovalFailureBody["mcp"],
): McpApprovalFailureBody {
	return {
		error: "MCP approval cannot be executed",
		reason,
		approvals: [projectApprovalForClient(item)],
		...(detail !== undefined ? { mcp: detail } : {}),
	};
}

export async function closeApprovalExecutionLeases(
	leases: Iterable<ApprovalExecutionLease>,
): Promise<void> {
	for (const lease of leases) {
		await lease.mcpManager?.close().catch(() => {});
	}
}

async function prepareMcpApprovalExecution(
	item: PendingApproval,
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflight> {
	if (!isMcpManagedToolName(item.tool)) {
		return { ok: true, lease: { approvalId: item.id } };
	}

	const parsed = parseToolName(item.tool);
	const declaration = item.mcpPromptDeclaration;
	if (!parsed || !declaration) {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody("mcp_approval_missing_declaration", item, {
				tool: item.tool,
				message: "Queued MCP approval is missing prompt declaration metadata.",
			}),
		};
	}
	if (parsed.server !== declaration.server || parsed.tool !== declaration.tool) {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody("mcp_approval_source_mismatch", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					declaration.promptDeclarationFingerprint.slice(0, 12),
			}),
		};
	}

	const cwd = context?.cwd ?? process.cwd();
	const config = McpManager.loadConfig(cwd);
	if (!config) {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody("mcp_approval_manager_unavailable", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					declaration.promptDeclarationFingerprint.slice(0, 12),
				message: "No current MCP configuration is available for this approval scope.",
			}),
		};
	}

	const mcpManager = new McpManager({ projectDir: cwd });
	try {
		await mcpManager.initialize(config);
	} catch (err) {
		await mcpManager.close().catch(() => {});
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody("mcp_approval_manager_unavailable", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					declaration.promptDeclarationFingerprint.slice(0, 12),
				message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
			}),
		};
	}

	const currentFingerprint = mcpManager.getToolDeclarationFingerprint(item.tool);
	if (currentFingerprint !== declaration.promptDeclarationFingerprint) {
		await mcpManager.close().catch(() => {});
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_DECLARATION_CHANGED_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					declaration.promptDeclarationFingerprint.slice(0, 12),
				currentDeclarationFingerprintPrefix:
					currentFingerprint?.slice(0, 12) ?? null,
			}),
		};
	}

	return {
		ok: true,
		lease: { approvalId: item.id, mcpManager },
	};
}

export async function prepareApprovalExecutionBatch(
	items: PendingApproval[],
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflightBatch> {
	const leases = new Map<string, ApprovalExecutionLease>();
	for (const item of items) {
		const preflight = await prepareMcpApprovalExecution(item, context);
		if (!preflight.ok) {
			await closeApprovalExecutionLeases(leases.values());
			return preflight;
		}
		leases.set(item.id, preflight.lease);
	}
	return { ok: true, leases };
}

function projectToolExecution(result: ToolResult): ApprovalExecutionProjection {
	const projected = projectEvidenceText(result.content, "daemon-api", "tool-io");
	const output = typeof projected === "string"
		? {
			redacted: true as const,
			reason: "tool-io" as const,
			bytes: Buffer.byteLength(projected, "utf8"),
		}
		: {
			redacted: true as const,
			reason: "tool-io" as const,
			...(projected.bytes !== undefined ? { bytes: projected.bytes } : {}),
		};
	return {
		status: result.is_error ? "failed" : "succeeded",
		output,
	};
}

async function executeApprovedTool(
	item: PendingApproval,
	context?: ToolRunnerContext,
	lease?: ApprovalExecutionLease,
): Promise<ApprovalExecutionProjection> {
	const executionContext = approvalExecutionContext(context, item);
	if (isMcpManagedToolName(item.tool)) {
		const result = lease?.mcpManager
			? await lease.mcpManager.executeTool(item.tool, item.input)
			: {
				content:
					`MCP tool error: approved MCP tool "${item.tool}" has no live MCP execution manager.`,
				is_error: true,
			};
		return projectToolExecution(result);
	}
	const result = executionContext
		? await executeTool(item.tool, item.input, executionContext)
		: await executeTool(item.tool, item.input);
	return projectToolExecution(result);
}

export async function approvedApprovalResponse(
	item: PendingApproval,
	context?: ToolRunnerContext,
	lease?: ApprovalExecutionLease,
): Promise<{
	approval: ApprovalClientProjection;
	execution: ApprovalExecutionProjection;
}> {
	const execution = await executeApprovedTool(item, context, lease);
	return {
		approval: projectApprovalForClient(item),
		execution,
	};
}

export async function approveAllResponse(
	items: PendingApproval[],
	context?: ToolRunnerContext,
	leases?: Map<string, ApprovalExecutionLease>,
): Promise<{
	approvals: ApprovalClientProjection[];
	count: number;
	executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }>;
}> {
	const executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }> = [];
	for (const item of items) {
		executions.push({
			approvalId: item.id,
			execution: await executeApprovedTool(item, context, leases?.get(item.id)),
		});
	}
	return {
		approvals: items.map((item) => projectApprovalForClient(item)),
		count: items.length,
		executions,
	};
}
