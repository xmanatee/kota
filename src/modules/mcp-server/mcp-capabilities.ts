import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";

export function buildMcpServerDiscoverCapabilities(): KotaJsonObject {
	return {
		tools: {},
		resources: { listChanged: true },
		prompts: { listChanged: true },
		completions: {},
		logging: {},
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
		tasks: {
			list: true,
			cancel: true,
			toolRequests: true,
		},
	};
}
