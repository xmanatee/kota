/**
 * Module Factory — tool definition.
 */

import type { KotaTool } from "#core/agent-harness/message-protocol.js";

export const moduleFactoryTool: KotaTool = {
	name: "module_factory",
	description:
		"Save, list, remove, inspect, or query logs from custom module manifests. " +
		"The runtime loader applies saved changes on its next load. " +
		"Use code_exec for temporary code; module tools hold reusable code.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["create", "list", "remove", "info", "logs"],
				description:
					"create: define a new module. list: show all custom modules. " +
					"remove: delete a saved manifest. info: show details of one module. " +
					"logs: query persistent module operation logs.",
			},
			manifest: {
				type: "object",
				description:
					'Module manifest (for create). Must include "name" (string). ' +
					'Optional: "description", "version", "tools" (array), "dependencies" (array). ' +
					'Each tool requires "name", "description", "code"; optional "language" (python or node), "parameters" (JSON Schema), "group".',
			},
			name: {
				type: "string",
				description: "Module name (for remove/info/logs actions)",
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
