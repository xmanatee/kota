import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { buildMcpUiServerCapability, MCP_UI_EXTENSION_ID } from "./mcp-apps.js";
import { MCP_TASKS_EXTENSION_ID } from "./mcp-protocol-types.js";
import { MCP_SKILLS_EXTENSION_ID } from "./resources.js";

type McpCapabilityOptions = {
	includeSkills?: boolean;
};

function buildMcpServerExtensions(options: McpCapabilityOptions): KotaJsonObject {
	return {
		[MCP_UI_EXTENSION_ID]: buildMcpUiServerCapability(),
		[MCP_TASKS_EXTENSION_ID]: {},
		...(options.includeSkills === true && { [MCP_SKILLS_EXTENSION_ID]: {} }),
	};
}

export function buildMcpServerDiscoverCapabilities(
	options: McpCapabilityOptions = {},
): KotaJsonObject {
	return {
		tools: {},
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: {},
		logging: {},
		extensions: buildMcpServerExtensions(options),
	};
}

export function buildMcpServerCardCapabilitySummary(
	options: McpCapabilityOptions = {},
): KotaJsonObject {
	return {
		tools: true,
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: true,
		logging: true,
		extensions: buildMcpServerExtensions(options),
	};
}
