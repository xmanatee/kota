import type { ApprovalMcpPromptDeclaration } from "#core/daemon/approval-queue.js";
import type { McpManager } from "#core/mcp/manager.js";
import { parseToolName } from "#core/mcp/tool-namespace.js";
import type { ToolResult } from "./index.js";
import type { McpPromptToolDeclarationFingerprints } from "./tool-runner-types.js";

const MCP_DECLARATION_CHANGED_REASON = "mcp_declaration_changed_since_prompt";

export function mcpPromptDeclarationForApproval(
	toolName: string,
	mcpManager: McpManager | undefined,
	promptFingerprints: McpPromptToolDeclarationFingerprints | undefined,
): ApprovalMcpPromptDeclaration | undefined {
	const promptDeclarationFingerprint = promptFingerprints?.get(toolName);
	if (promptDeclarationFingerprint === undefined) return undefined;
	const serverTransportIdentityFingerprint =
		mcpManager?.getToolServerTransportIdentityFingerprint(toolName);
	if (serverTransportIdentityFingerprint === undefined) return undefined;
	const parsed = parseToolName(toolName);
	if (!parsed) return undefined;
	return {
		server: parsed.server,
		tool: parsed.tool,
		promptDeclarationFingerprint,
		serverTransportIdentityFingerprint,
	};
}

export function staleMcpDeclarationResult(
	toolName: string,
	mcpManager: McpManager | undefined,
	promptFingerprints: McpPromptToolDeclarationFingerprints | undefined,
): ToolResult | null {
	const promptFingerprint = promptFingerprints?.get(toolName);
	if (promptFingerprint === undefined) return null;
	const currentFingerprint = mcpManager?.getToolDeclarationFingerprint(toolName);
	if (currentFingerprint === promptFingerprint) return null;
	const promptPrefix = promptFingerprint.slice(0, 12);
	const currentPrefix = currentFingerprint?.slice(0, 12) ?? "missing";
	return {
		content:
			`MCP tool error: reason=${MCP_DECLARATION_CHANGED_REASON}; ` +
			`declaration for "${toolName}" changed since it was ` +
			`shown to the model (${promptPrefix} -> ${currentPrefix}); retry after ` +
			"the refreshed tool list is shown.",
		is_error: true,
		_meta: {
			mcp: {
				reason: MCP_DECLARATION_CHANGED_REASON,
				tool: toolName,
				promptDeclarationFingerprintPrefix: promptPrefix,
				currentDeclarationFingerprintPrefix: currentFingerprint?.slice(0, 12) ?? null,
			},
		},
	};
}
