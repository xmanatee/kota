/**
 * Module Factory — tool definition (Anthropic tool schema).
 */

import type Anthropic from "@anthropic-ai/sdk";

export const moduleFactoryTool: Anthropic.Tool = {
	name: "module_factory",
	description:
		"Create, list, remove, inspect, run scripts, or query logs from custom modules. " +
		"Modules bundle related tools, scripts, and metadata. " +
		"Logs capture module operations (events, scripts, lifecycle) for observability.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["create", "list", "remove", "info", "run", "logs"],
				description:
					"create: define a new module. list: show all custom modules. " +
					"remove: unload and delete. info: show details of one module. " +
					"run: execute a named script. " +
					"logs: query persistent module operation logs.",
			},
			manifest: {
				type: "object",
				description:
					'Module manifest (for create). Must include "name" (string). ' +
					'Optional: "description", "version", "tools" (array), ' +
					'"scripts" (object mapping script names to {steps: [{tool, input}]}), "dependencies" (array).',
			},
			name: {
				type: "string",
				description: "Module name (for remove/info/run/logs actions)",
			},
			script: {
				type: "string",
				description: "Script name to execute (for run action)",
			},
			args: {
				type: "object",
				description:
					'Arguments passed to the script. Available in step inputs via "$payload".',
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
