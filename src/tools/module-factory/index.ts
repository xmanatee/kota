/**
 * Module Factory Tool — router and public API.
 *
 * Implementation split into: definition, state, actions, logs.
 */

import type { ToolResult } from "../index.js";
import { handleCreate, handleInfo, handleList, handleRemove } from "./actions.js";
import { moduleFactoryTool } from "./definition.js";
import { handleLogs } from "./logs.js";

// Public API
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
		case "logs":
			return handleLogs(input);
		default:
			return {
				content: `Unknown action: "${action}". Use create, list, remove, info, or logs.`,
				is_error: true,
			};
	}
}

export const registration = {
	tool: moduleFactoryTool,
	runner: runModuleFactory,
	risk: "moderate" as const,
	kind: "action" as const,
};
