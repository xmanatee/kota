import {
	type ApprovalExecutionDescriptor,
	approvedApprovalMatchesExecutionDescriptor,
} from "#core/daemon/approval-execution-descriptor.js";
import {
	type ApprovalClientProjection,
	type ApprovalExecutionSnapshot,
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

export type ApprovalExecutionLease = ApprovalExecutionDescriptor & {
	mcpManager?: McpManager;
};

export class ApprovalExecutionDescriptorMismatchError extends Error {
	constructor(readonly approval: PendingApproval) {
		super(`Approval ${approval.id} no longer matches its execution lease`);
		this.name = "ApprovalExecutionDescriptorMismatchError";
	}
}

type McpApprovalFailureReason =
	| "mcp_approval_missing_declaration"
	| "mcp_approval_source_mismatch"
	| "mcp_approval_manager_unavailable"
	| "mcp_declaration_changed_since_prompt"
	| "mcp_server_transport_changed_since_prompt"
	| "mcp_server_transport_identity_ambiguous";

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
		promptServerTransportIdentityFingerprintPrefix?: string;
		currentServerTransportIdentityFingerprintPrefix?: string | null;
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
const MCP_SERVER_TRANSPORT_CHANGED_REASON = "mcp_server_transport_changed_since_prompt";
const MCP_SERVER_TRANSPORT_IDENTITY_AMBIGUOUS_REASON =
	"mcp_server_transport_identity_ambiguous";

function fingerprintPrefix(fingerprint: string): string {
	return fingerprint.slice(0, 12);
}

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
	const managers = new Set<McpManager>();
	for (const lease of leases) {
		if (lease.mcpManager !== undefined) managers.add(lease.mcpManager);
	}
	await Promise.all([...managers].map((manager) => manager.close()));
}

async function closeAfterFailure(
	close: () => Promise<void>,
	primaryError: Error,
	message: string,
): Promise<void> {
	try {
		await close();
	} catch (cleanupError) {
		throw new AggregateError([primaryError, cleanupError], message);
	}
}

export async function withApprovalExecutionLeases<T>(
	leases: Iterable<ApprovalExecutionLease>,
	execute: () => Promise<T>,
): Promise<T> {
	const retainedLeases = [...leases];
	let result: T;
	try {
		result = await execute();
	} catch (error) {
		const primaryError = error instanceof Error ? error : new Error(String(error));
		await closeAfterFailure(
			() => closeApprovalExecutionLeases(retainedLeases),
			primaryError,
			"Approval execution and lease cleanup both failed",
		);
		throw error;
	}
	await closeApprovalExecutionLeases(retainedLeases);
	return result;
}

async function prepareMcpApprovalExecution(
	snapshot: ApprovalExecutionSnapshot,
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflight> {
	const item = snapshot.approval;
	if (!isMcpManagedToolName(item.tool)) {
		return { ok: true, lease: { ...snapshot.descriptor } };
	}

	const parsed = parseToolName(item.tool);
	const declaration = item.mcpPromptDeclaration;
	if (
		!parsed ||
		!declaration ||
		typeof declaration.serverTransportIdentityFingerprint !== "string"
	) {
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
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
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
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				message: "No current MCP configuration is available for this approval scope.",
			}),
		};
	}

	const mcpManager = new McpManager({ projectDir: cwd });
	try {
		await mcpManager.initialize(config);
	} catch (err) {
		const primaryError = err instanceof Error ? err : new Error(String(err));
		await closeAfterFailure(
			() => mcpManager.close(),
			primaryError,
			"MCP approval preflight failed and its manager could not close",
		);
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody("mcp_approval_manager_unavailable", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
			}),
		};
	}

	const currentFingerprint = mcpManager.getToolDeclarationFingerprint(item.tool);
	if (currentFingerprint !== declaration.promptDeclarationFingerprint) {
		await mcpManager.close();
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_DECLARATION_CHANGED_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentFingerprint === undefined ? null : fingerprintPrefix(currentFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
			}),
		};
	}

	const currentTransportIdentity = mcpManager.getToolServerTransportIdentity(item.tool);
	if (
		!currentTransportIdentity ||
		currentTransportIdentity.fingerprint !== declaration.serverTransportIdentityFingerprint
	) {
		await mcpManager.close();
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_SERVER_TRANSPORT_CHANGED_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentFingerprint === undefined ? null : fingerprintPrefix(currentFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix:
					currentTransportIdentity === undefined
						? null
						: fingerprintPrefix(currentTransportIdentity.fingerprint),
			}),
		};
	}
	if (currentTransportIdentity.match.kind === "ambiguous") {
		await mcpManager.close();
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_SERVER_TRANSPORT_IDENTITY_AMBIGUOUS_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentFingerprint === undefined ? null : fingerprintPrefix(currentFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(currentTransportIdentity.fingerprint),
				message: currentTransportIdentity.match.reason,
			}),
		};
	}

	return {
		ok: true,
		lease: { ...snapshot.descriptor, mcpManager },
	};
}

export async function prepareApprovalExecutionBatch(
	snapshots: ApprovalExecutionSnapshot[],
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflightBatch> {
	const leases = new Map<string, ApprovalExecutionLease>();
	for (const snapshot of snapshots) {
		const preflight = await prepareMcpApprovalExecution(snapshot, context);
		if (!preflight.ok) {
			await closeApprovalExecutionLeases(leases.values());
			return preflight;
		}
		leases.set(snapshot.approval.id, preflight.lease);
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

function requireApprovedToolExecutionLease(
	item: PendingApproval,
	lease: ApprovalExecutionLease | undefined,
): ApprovalExecutionLease {
	if (
		lease === undefined
		|| !approvedApprovalMatchesExecutionDescriptor(item, lease)
		|| (isMcpManagedToolName(item.tool) && lease.mcpManager === undefined)
	) {
		throw new ApprovalExecutionDescriptorMismatchError(item);
	}
	return lease;
}

async function executeApprovedTool(
	item: PendingApproval,
	context?: ToolRunnerContext,
	lease?: ApprovalExecutionLease,
): Promise<ApprovalExecutionProjection> {
	const boundLease = requireApprovedToolExecutionLease(item, lease);
	const executionContext = approvalExecutionContext(context, item);
	if (isMcpManagedToolName(item.tool)) {
		const mcpManager = boundLease.mcpManager;
		if (mcpManager === undefined) {
			throw new ApprovalExecutionDescriptorMismatchError(item);
		}
		const result = await mcpManager.executeTool(item.tool, item.input);
		return projectToolExecution(result);
	}
	const result = executionContext
		? await executeTool(item.tool, item.input, executionContext)
		: await executeTool(item.tool, item.input);
	return projectToolExecution(result);
}

export async function approvedApprovalResponse(
	item: PendingApproval,
	context: ToolRunnerContext | undefined,
	lease: ApprovalExecutionLease,
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
	context: ToolRunnerContext | undefined,
	leases: Map<string, ApprovalExecutionLease>,
): Promise<{
	approvals: ApprovalClientProjection[];
	count: number;
	executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }>;
}> {
	for (const item of items) {
		requireApprovedToolExecutionLease(item, leases.get(item.id));
	}
	const executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }> = [];
	for (const item of items) {
		executions.push({
			approvalId: item.id,
			execution: await executeApprovedTool(item, context, leases.get(item.id)),
		});
	}
	return {
		approvals: items.map((item) => projectApprovalForClient(item)),
		count: items.length,
		executions,
	};
}
