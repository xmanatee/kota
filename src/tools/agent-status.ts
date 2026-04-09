import type Anthropic from "@anthropic-ai/sdk";
import { getProviderRegistry } from "../extensions/providers/index.js";
import { getEnabledGroups, TOOL_GROUPS } from "../tool-groups.js";
import { getCoreRegistrations, getExtensionToolRisk, getRegisteredTools, type ToolRegistration, type ToolResult } from "./index.js";

export const agentStatusTool: Anthropic.Tool = {
	name: "agent_status",
	description:
		"Introspect the agent's runtime state: available tools, loaded extensions, " +
		"active providers, enabled tool groups, and config. Use when you need to " +
		"discover capabilities, check what extensions are loaded, or verify configuration.",
	input_schema: {
		type: "object" as const,
		properties: {
			query: {
				type: "string",
				enum: ["tools", "extensions", "providers", "groups", "config", "all"],
				description:
					"What to inspect. tools: list available tools. extensions: loaded extensions. " +
					"providers: registered service providers. groups: tool groups and status. " +
					"config: current settings. all: everything.",
			},
			filter: {
				type: "string",
				description: "Optional text filter — only show items matching this substring (case-insensitive).",
			},
		},
		required: ["query"],
	},
};

// --- Extension info provider (set by loop.ts to avoid circular imports) ---

export type ExtensionStatusEntry = {
	name: string;
	toolCount: number;
};

type ExtensionInfoProvider = () => ExtensionStatusEntry[];
type ConfigProvider = () => Record<string, unknown>;

let _extensionInfoProvider: ExtensionInfoProvider | null = null;
let _configProvider: ConfigProvider | null = null;

export function setExtensionInfoProvider(fn: ExtensionInfoProvider): void {
	_extensionInfoProvider = fn;
}

export function setConfigProvider(fn: ConfigProvider): void {
	_configProvider = fn;
}

export function resetAgentStatusProviders(): void {
	_extensionInfoProvider = null;
	_configProvider = null;
}

// --- Runner ---

export async function runAgentStatus(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const query = (input.query as string) || "all";
	const filter = (input.filter as string)?.toLowerCase() || "";

	const sections: string[] = [];

	if (query === "tools" || query === "all") {
		sections.push(formatTools(filter));
	}
	if (query === "extensions" || query === "all") {
		sections.push(formatExtensions(filter));
	}
	if (query === "providers" || query === "all") {
		sections.push(formatProviders(filter));
	}
	if (query === "groups" || query === "all") {
		sections.push(formatGroups(filter));
	}
	if (query === "config" || query === "all") {
		sections.push(formatConfig(filter));
	}

	const result = sections.filter(Boolean).join("\n\n");
	return { content: result || "No data available." };
}

function matches(text: string, filter: string): boolean {
	return !filter || text.toLowerCase().includes(filter);
}

function formatTools(filter: string): string {
	const core = getCoreRegistrations();
	const extensionTools = getRegisteredTools();

	const lines: string[] = ["## Tools"];

	const coreFiltered = core.filter(
		(r) => matches(r.tool.name, filter) || matches(r.tool.description || "", filter),
	);
	if (coreFiltered.length > 0) {
		lines.push(`\nCore tools (${coreFiltered.length}):`);
		for (const r of coreFiltered) {
			lines.push(formatToolLine(r));
		}
	}

	const extensionFiltered = extensionTools.filter(
		(t) => matches(t.name, filter) || matches(t.description || "", filter),
	);
	if (extensionFiltered.length > 0) {
		lines.push(`\nExtension tools (${extensionFiltered.length}):`);
		for (const t of extensionFiltered) {
			const group = findToolGroup(t.name);
			const risk = getExtensionToolRisk(t.name);
			const groupTag = group ? ` [${group}]` : "";
			const riskTag = risk && risk !== "safe" ? ` (${risk})` : "";
			lines.push(`- ${t.name}${groupTag}${riskTag}: ${truncate(t.description || "(no description)", 80)}`);
		}
	}

	if (coreFiltered.length === 0 && extensionFiltered.length === 0) {
		lines.push("(no tools match filter)");
	}

	return lines.join("\n");
}

/** Find the group name a tool belongs to by looking it up in TOOL_GROUPS. */
function findToolGroup(toolName: string): string | undefined {
	for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
		if (tools.includes(toolName)) return group;
	}
	return undefined;
}

function formatToolLine(r: ToolRegistration): string {
	const group = r.group ? ` [${r.group}]` : " [core]";
	const risk = r.risk !== "safe" ? ` (${r.risk})` : "";
	return `- ${r.tool.name}${group}${risk}: ${truncate(r.tool.description || "", 80)}`;
}

function formatExtensions(filter: string): string {
	const lines: string[] = ["## Extensions"];

	if (!_extensionInfoProvider) {
		lines.push("(extension info not available)");
		return lines.join("\n");
	}

	const extensions = _extensionInfoProvider();
	const filtered = extensions.filter((extension) => matches(extension.name, filter));

	if (filtered.length === 0) {
		lines.push(
			extensions.length > 0
				? "(no extensions match filter)"
				: "(no extensions loaded)",
		);
		return lines.join("\n");
	}

	lines.push(`${filtered.length} extension(s) loaded:`);
	for (const extension of filtered) {
		const tools = extension.toolCount > 0 ? ` (${extension.toolCount} tools)` : "";
		lines.push(`- ${extension.name}${tools}`);
	}

	return lines.join("\n");
}

function formatProviders(filter: string): string {
	const lines: string[] = ["## Providers"];
	const reg = getProviderRegistry();

	if (!reg) {
		lines.push("(provider registry not initialized)");
		return lines.join("\n");
	}

	const types = reg.listTypes();
	if (types.length === 0) {
		lines.push("(no providers registered)");
		return lines.join("\n");
	}

	const filtered = types.filter((t) => matches(t, filter));
	if (filtered.length === 0) {
		lines.push("(no providers match filter)");
		return lines.join("\n");
	}

	for (const type of filtered) {
		const active = reg.getActiveName(type);
		const all = reg.list(type);
		const providerList = all
			.map((name) => (name === active ? `**${name}** (active)` : name))
			.join(", ");
		lines.push(`- ${type}: ${providerList}`);
	}

	return lines.join("\n");
}

function formatGroups(filter: string): string {
	const lines: string[] = ["## Tool Groups"];
	const enabled = new Set(getEnabledGroups());

	const groups = Object.entries(TOOL_GROUPS).filter(([name]) => matches(name, filter));

	if (groups.length === 0) {
		lines.push("(no groups match filter)");
		return lines.join("\n");
	}

	for (const [name, tools] of groups) {
		const status = enabled.has(name) ? " [enabled]" : " [disabled]";
		lines.push(`- ${name}${status}: ${tools.join(", ")}`);
	}

	return lines.join("\n");
}

function formatConfig(filter: string): string {
	const lines: string[] = ["## Config"];

	if (!_configProvider) {
		lines.push("(config not available)");
		return lines.join("\n");
	}

	const config = _configProvider();
	const entries = Object.entries(config).filter(
		([key, val]) => val !== undefined && matches(key, filter),
	);

	if (entries.length === 0) {
		lines.push("(no config entries match filter)");
		return lines.join("\n");
	}

	for (const [key, val] of entries) {
		if (key === "modelProvider" && typeof val === "object" && val !== null) {
			const mp = val as Record<string, unknown>;
			const safe = { type: mp.type, baseUrl: mp.baseUrl };
			lines.push(`- ${key}: ${JSON.stringify(safe)}`);
		} else {
			lines.push(`- ${key}: ${JSON.stringify(val)}`);
		}
	}

	return lines.join("\n");
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}...` : s;
}

export const registration: ToolRegistration = {
	tool: agentStatusTool,
	runner: runAgentStatus,
	risk: "safe" as const,
	kind: "discovery" as const,
};
