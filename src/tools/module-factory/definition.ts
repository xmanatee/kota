/**
 * Extension Factory — tool definition (Anthropic tool schema).
 */

import type Anthropic from "@anthropic-ai/sdk";

export const extensionFactoryTool: Anthropic.Tool = {
	name: "extension_factory",
	description:
		"Create, list, remove, inspect, or query logs from custom extensions. " +
		"Extensions bundle related tools and metadata. " +
		"Logs capture extension operations for observability.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["create", "list", "remove", "info", "logs"],
				description:
					"create: define a new extension. list: show all custom extensions. " +
					"remove: unload and delete. info: show details of one extension. " +
					"logs: query persistent extension operation logs.",
			},
			manifest: {
				type: "object",
				description:
					'Extension manifest (for create). Must include "name" (string). ' +
					'Optional: "description", "version", "tools" (array), "dependencies" (array).',
			},
			name: {
				type: "string",
				description: "Extension name (for remove/info/logs actions)",
			},
			level: {
				type: "string",
				enum: ["info", "warn", "error", "debug"],
				description: "Filter logs by level (for logs action)",
			},
			keyword: {
				type: "string",
				description: "Search keyword for log messages (for logs action)",
			},
			limit: {
				type: "number",
				description:
					"Max log entries to return (default 30, for logs action)",
			},
		},
		required: ["action"],
	},
};
