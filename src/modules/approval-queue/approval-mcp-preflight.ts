import type { ApprovalExecutionSnapshot, PendingApproval } from "#core/daemon/approval-queue.js";
import { projectApprovalForClient } from "#core/daemon/approval-queue.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { McpManager } from "#core/mcp/manager.js";
import { parseToolName } from "#core/mcp/tool-namespace.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { isMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import type { ApprovalExecutionLease } from "./approval-execution.js";
import { closeAfterApprovalExecutionFailure } from "./approval-execution-cleanup.js";

type McpApprovalFailureReason =
	| "mcp_approval_missing_declaration"
	| "mcp_approval_source_mismatch"
	| "mcp_approval_manager_unavailable"
	| "mcp_declaration_changed_since_prompt"
	| "mcp_server_transport_changed_since_prompt"
	| "mcp_server_transport_identity_ambiguous";

export type McpApprovalFailureBody = {
	error: string;
	reason: McpApprovalFailureReason;
	approvals: ReturnType<typeof projectApprovalForClient>[];
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

function prefix(fingerprint: string): string {
	return fingerprint.slice(0, 12);
}

function failure(
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

export async function prepareMcpApprovalExecution(
	snapshot: ApprovalExecutionSnapshot,
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflight> {
	const item = snapshot.approval;
	if (!isMcpManagedToolName(item.tool)) {
		return { ok: true, lease: { ...snapshot.descriptor } };
	}

	const parsed = parseToolName(item.tool);
	const declaration = item.mcpPromptDeclaration;
	if (!parsed || !declaration || typeof declaration.serverTransportIdentityFingerprint !== "string") {
		return {
			ok: false,
			status: 409,
			body: failure("mcp_approval_missing_declaration", item, {
				tool: item.tool,
				message: "Queued MCP approval is missing prompt declaration metadata.",
			}),
		};
	}
	if (parsed.server !== declaration.server || parsed.tool !== declaration.tool) {
		return {
			ok: false,
			status: 409,
			body: failure("mcp_approval_source_mismatch", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
			}),
		};
	}

	const cwd = context?.cwd ?? process.cwd();
	const config = McpManager.loadConfig(cwd);
	if (!config) {
		return {
			ok: false,
			status: 409,
			body: failure("mcp_approval_manager_unavailable", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
				message: "No current MCP configuration is available for this approval scope.",
			}),
		};
	}

	const manager = new McpManager({ projectDir: cwd });
	try {
		await manager.initialize(config);
	} catch (error) {
		const primaryError = error instanceof Error ? error : new Error(String(error));
		await closeAfterApprovalExecutionFailure(
			() => manager.close(),
			primaryError,
			"MCP approval preflight failed and its manager could not close",
		);
		return {
			ok: false,
			status: 409,
			body: failure("mcp_approval_manager_unavailable", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
				message: redactSensitiveText(primaryError.message),
			}),
		};
	}

	const currentDeclaration = manager.getToolDeclarationFingerprint(item.tool);
	if (currentDeclaration !== declaration.promptDeclarationFingerprint) {
		await manager.close();
		return {
			ok: false,
			status: 409,
			body: failure("mcp_declaration_changed_since_prompt", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentDeclaration === undefined ? null : prefix(currentDeclaration),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
			}),
		};
	}

	const currentTransport = manager.getToolServerTransportIdentity(item.tool);
	if (!currentTransport || currentTransport.fingerprint !== declaration.serverTransportIdentityFingerprint) {
		await manager.close();
		return {
			ok: false,
			status: 409,
			body: failure("mcp_server_transport_changed_since_prompt", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentDeclaration === undefined ? null : prefix(currentDeclaration),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix:
					currentTransport === undefined ? null : prefix(currentTransport.fingerprint),
			}),
		};
	}
	if (currentTransport.match.kind === "ambiguous") {
		await manager.close();
		return {
			ok: false,
			status: 409,
			body: failure("mcp_server_transport_identity_ambiguous", item, {
				tool: item.tool,
				server: declaration.server,
				remoteTool: declaration.tool,
				promptDeclarationFingerprintPrefix: prefix(declaration.promptDeclarationFingerprint),
				currentDeclarationFingerprintPrefix:
					currentDeclaration === undefined ? null : prefix(currentDeclaration),
				promptServerTransportIdentityFingerprintPrefix:
					prefix(declaration.serverTransportIdentityFingerprint),
				currentServerTransportIdentityFingerprintPrefix: prefix(currentTransport.fingerprint),
				message: currentTransport.match.reason,
			}),
		};
	}

	return { ok: true, lease: { ...snapshot.descriptor, mcpManager: manager } };
}
