import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import { buildMcpUiServerCapability, MCP_UI_EXTENSION_ID } from "./mcp-apps.js";

export function buildMcpServerDiscoverCapabilities(): KotaJsonObject {
	return {
		tools: {},
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: {},
		logging: {},
		extensions: {
			[MCP_UI_EXTENSION_ID]: buildMcpUiServerCapability(),
		},
		tasks: {
			list: {},
			cancel: {},
			requests: {
				tools: {
					call: {},
				},
			},
		},
	};
}

export function buildMcpServerCardCapabilitySummary(): KotaJsonObject {
	return {
		tools: true,
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: true,
		logging: true,
		extensions: {
			[MCP_UI_EXTENSION_ID]: buildMcpUiServerCapability(),
		},
		tasks: {
			list: true,
			cancel: true,
			toolRequests: true,
		},
	};
}
