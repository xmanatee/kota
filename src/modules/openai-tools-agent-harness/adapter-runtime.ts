import {
	type AgentHarnessRunOptions,
	agentHarnessToolExecutionOptions,
	type KotaMessage,
	type KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import { McpManager, type McpServerConfig } from "#core/mcp/manager.js";
import {
	executeToolCalls,
	type McpPromptToolDeclarationFingerprints,
	type ToolResultEntry,
} from "#core/tools/tool-runner.js";
import type { ValidatedToolUseBlock } from "./tool-loop.js";

export function resolveScopeRoot(options: AgentHarnessRunOptions): string {
	return options.cwd ?? process.cwd();
}

function toMcpServerConfigMap(
	servers: AgentHarnessRunOptions["mcpServers"],
): Record<string, McpServerConfig> {
	const out: Record<string, McpServerConfig> = {};
	for (const [name, config] of Object.entries(servers ?? {})) {
		if (config.type === "sse") {
			throw new Error(
				`MCP server "${name}" uses unsupported transport type "sse"; use KOTA's "http" MCP transport.`,
			);
		}
		out[name] = config;
	}
	return out;
}

function resolveMcpConfig(
	scopeRoot: string,
	sessionServers: AgentHarnessRunOptions["mcpServers"],
	scopeConfigPolicy: AgentHarnessRunOptions["mcpScopeConfigPolicy"],
): { mcpServers: Record<string, McpServerConfig> } | null {
	const scopeConfig = scopeConfigPolicy === "disabled"
		? null
		: McpManager.loadConfig(scopeRoot);
	const sessionEntries = Object.entries(toMcpServerConfigMap(sessionServers));
	if (!scopeConfig && sessionEntries.length === 0) return null;

	const mcpServers: Record<string, McpServerConfig> = {
		...(scopeConfig?.mcpServers ?? {}),
	};
	for (const [name, config] of sessionEntries) {
		if (Object.hasOwn(mcpServers, name)) {
			throw new Error(
				`MCP server "${name}" is defined by both scope config and session options`,
			);
		}
		mcpServers[name] = config;
	}
	return { mcpServers };
}

export async function initializeMcpManager(
	options: AgentHarnessRunOptions,
): Promise<McpManager | undefined> {
	const scopeRoot = resolveScopeRoot(options);
	const config = resolveMcpConfig(
		scopeRoot,
		options.mcpServers,
		options.mcpScopeConfigPolicy,
	);
	if (!config) return undefined;
	const manager = new McpManager({ scopeRoot });
	await manager.initialize(config);
	return manager;
}

export function snapshotMcpToolDeclarationFingerprints(
	manager: McpManager | undefined,
	tools: readonly { name: string }[],
): ReadonlyMap<string, string> | undefined {
	if (!manager) return undefined;
	const entries = tools.flatMap((tool) => {
		const fingerprint = manager.getToolDeclarationFingerprint(tool.name);
		return fingerprint === undefined ? [] : [[tool.name, fingerprint] as const];
	});
	return entries.length === 0 ? undefined : new Map(entries);
}

export function toolResultEntryToBlock(entry: ToolResultEntry): KotaToolResultBlock {
	return {
		type: "tool_result",
		tool_use_id: entry.tool_use_id,
		content: entry.blocks ? entry.blocks : entry.content,
		...(entry.structuredContent ? { structuredContent: entry.structuredContent } : {}),
		...(entry._meta ? { _meta: entry._meta } : {}),
		is_error: entry.is_error === true,
	};
}

export function executeOpenaiToolCalls(
	toolBlocks: ValidatedToolUseBlock[],
	options: AgentHarnessRunOptions,
	context: {
		mcpManager: McpManager | undefined;
		mcpPromptToolDeclarationFingerprints:
			| McpPromptToolDeclarationFingerprints
			| undefined;
		scopeRoot: string;
		abortSignal: AbortSignal | undefined;
		messages: KotaMessage[];
	},
): Promise<ToolResultEntry[]> {
	return executeToolCalls(toolBlocks, {
		...agentHarnessToolExecutionOptions(options, {
			resultLimit: 50_000,
			cwd: context.scopeRoot,
			...(context.abortSignal !== undefined
				? { signal: context.abortSignal }
				: {}),
		}),
		...(context.mcpManager !== undefined ? { mcpManager: context.mcpManager } : {}),
		...(context.mcpPromptToolDeclarationFingerprints !== undefined
			? {
					mcpPromptToolDeclarationFingerprints:
						context.mcpPromptToolDeclarationFingerprints,
				}
			: {}),
		messages: context.messages,
	});
}
