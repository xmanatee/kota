import { dirname } from "node:path";
import { getManifestPath } from "#core/manifest/persistence.js";
import type { ToolRegistration } from "#core/tools/tool-registry.js";
/**
 * Module Factory Tool — router and public API.
 *
 * Edits persisted declarations; ModuleLoader owns activation.
 */

import {
	localDestructiveEffect,
	localWriteEffect,
	readOnlyLocalEffect,
} from "#core/tools/effect.js";
import type { ToolResult, ToolRunnerContext } from "#core/tools/index.js";
import {
	handleCreate,
	handleInfo,
	handleList,
	handleRemove,
} from "./actions.js";
import { moduleFactoryTool } from "./definition.js";
import { handleLogs } from "./logs.js";

// Public API
export { moduleFactoryTool } from "./definition.js";
// ─── Runner ──────────────────────────────────────────────────────────

export async function runModuleFactory(
	input: Record<string, unknown>,
	context?: ToolRunnerContext,
): Promise<ToolResult> {
	const action = input.action as string;
	const cwd = context?.cwd;
	switch (action) {
		case "create":
			return handleCreate(input.manifest as Record<string, unknown>, cwd);
		case "list":
			return handleList(cwd);
		case "remove":
			return handleRemove(input.name as string, cwd);
		case "info":
			return handleInfo(input.name as string, cwd);
		case "logs":
			return handleLogs(input, context);
		default:
			return {
				content: `Unknown action: "${action}". Use create, list, remove, info, or logs.`,
				is_error: true,
			};
	}
}

export const registration: ToolRegistration = {
	tool: moduleFactoryTool,
	runner: runModuleFactory,
	effect: localWriteEffect(),
	resolveEffect: (input) => {
		switch (input.action) {
			case "list":
			case "info":
			case "logs":
				return readOnlyLocalEffect();
			case "create":
				return localWriteEffect();
			default:
				return localDestructiveEffect();
		}
	},
	resolveFilesystemTargets: (input, context) => {
    if (["list", "info", "logs"].includes(String(input.action))) return { kind: "none" };
		const manifest = input.manifest;
		const name =
			input.action === "create" &&
			manifest &&
			typeof manifest === "object" &&
			"name" in manifest
				? manifest.name
				: input.action === "remove"
					? input.name
					: undefined;
		if (typeof name !== "string") return { kind: "unknown" };
		return {
			kind: "known",
			paths: [dirname(getManifestPath(name, context?.cwd))],
		};
	},
};
