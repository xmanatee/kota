import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import { getCoreRegistrations, getModuleToolRisk, getRegisteredTools, type ToolRegistration, type ToolResult } from "./index.js";
import { getEnabledGroups, TOOL_GROUPS } from "./tool-groups.js";

export const agentStatusTool: KotaTool = {
	name: "agent_status",
	description:
		"Introspect the agent's runtime state: available tools, loaded modules, " +
		"active providers, enabled tool groups, and config. Use when you need to " +
		"discover capabilities, check what modules are loaded, or verify configuration.",
	input_schema: {
		type: "object" as const,
		properties: {
			query: {
				type: "string",
				enum: ["tools", "modules", "providers", "groups", "config", "all"],
				description:
					"What to inspect. tools: list available tools. modules: loaded modules. " +
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

// --- Module info provider (set by loop.ts to avoid circular imports) ---

export type ModuleStatusEntry = {
	name: string;
	toolCount: number;
};

type ModuleInfoProvider = () => ModuleStatusEntry[];
type ConfigProvider = () => Record<string, unknown>;

let _moduleInfoProvider: ModuleInfoProvider | null = null;
let _configProvider: ConfigProvider | null = null;

export function setModuleInfoProvider(fn: ModuleInfoProvider): void {
	_moduleInfoProvider = fn;
}

export function setConfigProvider(fn: ConfigProvider): void {
	_configProvider = fn;
}

export function resetAgentStatusProviders(): void {
	_moduleInfoProvider = null;
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
	if (query === "modules" || query === "all") {
		sections.push(formatModules(filter));
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
	const moduleTools = getRegisteredTools();

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

	const moduleFiltered = moduleTools.filter(
		(t) => matches(t.name, filter) || matches(t.description || "", filter),
	);
	if (moduleFiltered.length > 0) {
		lines.push(`\nModule tools (${moduleFiltered.length}):`);
		for (const t of moduleFiltered) {
			const group = findToolGroup(t.name);
			const risk = getModuleToolRisk(t.name);
			const groupTag = group ? ` [${group}]` : "";
			const riskTag = risk && risk !== "safe" ? ` (${risk})` : "";
			lines.push(`- ${t.name}${groupTag}${riskTag}: ${truncate(t.description || "(no description)", 80)}`);
		}
	}

	if (coreFiltered.length === 0 && moduleFiltered.length === 0) {
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

function formatModules(filter: string): string {
	const lines: string[] = ["## Modules"];

	if (!_moduleInfoProvider) {
		lines.push("(module info not available)");
		return lines.join("\n");
	}

	const modules = _moduleInfoProvider();
	const filtered = modules.filter((module) => matches(module.name, filter));

	if (filtered.length === 0) {
		lines.push(
			modules.length > 0
				? "(no modules match filter)"
				: "(no modules loaded)",
		);
		return lines.join("\n");
	}

	lines.push(`${filtered.length} module(s) loaded:`);
	for (const module of filtered) {
		const tools = module.toolCount > 0 ? ` (${module.toolCount} tools)` : "";
		lines.push(`- ${module.name}${tools}`);
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

	const ids = reg.listTokenIds();
	if (ids.length === 0) {
		lines.push("(no providers registered)");
		return lines.join("\n");
	}

	const filtered = ids.filter((t) => matches(t, filter));
	if (filtered.length === 0) {
		lines.push("(no providers match filter)");
		return lines.join("\n");
	}

	for (const id of filtered) {
		const { active, names } = reg.introspect(id);
		const providerList = names
			.map((name) => (name === active ? `**${name}** (active)` : name))
			.join(", ");
		lines.push(`- ${id}: ${providerList}`);
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
