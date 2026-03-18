/**
 * Module Factory Tool — thin facade.
 *
 * Implementation split into: definition, state, actions, scripts, logs.
 * This file wires the router and re-exports the public API.
 */

import type { ToolResult } from "../index.js";
import { handleCreate, handleInfo, handleList, handleRemove } from "./actions.js";
import { moduleFactoryTool } from "./definition.js";
import { handleLogs } from "./logs.js";
import { handleRun } from "./scripts.js";

// Re-export public API (preserves backward compatibility)
export { moduleFactoryTool } from "./definition.js";
export {
	getLoadedManifestModuleCount,
	markModuleLoaded,
	resetModuleFactory,
} from "./state.js";

// ─── Runner ──────────────────────────────────────────────────────────

export async function runModuleFactory(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;
	switch (action) {
		case "create":
			return handleCreate(input.manifest as Record<string, unknown>);
		case "list":
			return handleList();
		case "remove":
			return handleRemove(input.name as string);
		case "info":
			return handleInfo(input.name as string);
		case "run":
			return handleRun(
				input.name as string,
				input.script as string,
				(input.args as Record<string, unknown>) || {},
			);
		case "logs":
			return handleLogs(input);
		default:
			return {
				content: `Unknown action: "${action}". Use create, list, remove, info, run, or logs.`,
				is_error: true,
			};
	}
}

export const registration = {
	tool: moduleFactoryTool,
	runner: runModuleFactory,
	risk: "moderate" as const,
};
