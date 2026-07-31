import {
	type ApprovalClientProjection,
	type ApprovalExecutionSnapshot,
	isWorkflowGateApproval,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { McpManager } from "#core/mcp/manager.js";
import { mcpServerTransportIdentityFromConfig } from "#core/mcp/manager-config.js";
import { parseToolName } from "#core/mcp/tool-namespace.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { isMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import {
	type ApprovalExecutionLease,
	closeApprovalExecutionAfterFailure,
	closeApprovalExecutionLeases,
} from "./approval-execution-leases.js";
import {
	type LocalApprovalFailureBody,
	prepareLocalApprovalExecution,
} from "./approval-local-execution-preflight.js";

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
	| {
		ok: false;
		status: 409;
		body: McpApprovalFailureBody | LocalApprovalFailureBody;
	  };

export type ApprovalExecutionPreflightBatch =
	| { ok: true; leases: Map<string, ApprovalExecutionLease> }
	| {
		ok: false;
		status: 409;
		body: McpApprovalFailureBody | LocalApprovalFailureBody;
	  };

const MCP_DECLARATION_CHANGED_REASON = "mcp_declaration_changed_since_prompt";
const MCP_SERVER_TRANSPORT_CHANGED_REASON = "mcp_server_transport_changed_since_prompt";
const MCP_SERVER_TRANSPORT_IDENTITY_AMBIGUOUS_REASON =
	"mcp_server_transport_identity_ambiguous";

function fingerprintPrefix(fingerprint: string): string {
	return fingerprint.slice(0, 12);
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

async function prepareMcpApprovalExecution(
	snapshot: ApprovalExecutionSnapshot,
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflight> {
	const item = snapshot.approval;
	if (isWorkflowGateApproval(item)) {
		return { ok: true, lease: { ...snapshot.descriptor } };
	}
	if (!isMcpManagedToolName(item.tool)) {
		return prepareLocalApprovalExecution(snapshot);
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
	const serverConfig = config.mcpServers?.[declaration.server];
	if (serverConfig === undefined) {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_SERVER_TRANSPORT_CHANGED_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix: null,
			}),
		};
	}

	let currentTransportIdentity: ReturnType<typeof mcpServerTransportIdentityFromConfig>;
	try {
		currentTransportIdentity = mcpServerTransportIdentityFromConfig(
			declaration.server,
			serverConfig,
		);
	} catch (err) {
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
	if (currentTransportIdentity.fingerprint !== declaration.serverTransportIdentityFingerprint) {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_SERVER_TRANSPORT_CHANGED_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(currentTransportIdentity.fingerprint),
			}),
		};
	}
	if (currentTransportIdentity.match.kind === "ambiguous") {
		return {
			ok: false,
			status: 409,
			body: mcpFailureBody(MCP_SERVER_TRANSPORT_IDENTITY_AMBIGUOUS_REASON, item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix:
					fingerprintPrefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix:
					fingerprintPrefix(currentTransportIdentity.fingerprint),
				message: currentTransportIdentity.match.reason,
			}),
		};
	}

	const mcpManager = new McpManager({ projectDir: cwd });
	try {
		await mcpManager.initialize({
			mcpServers: { [declaration.server]: serverConfig },
		});
	} catch (err) {
		const primaryError = err instanceof Error ? err : new Error(String(err));
		await closeApprovalExecutionAfterFailure(
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

	return { ok: true, lease: { ...snapshot.descriptor, mcpManager } };
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
