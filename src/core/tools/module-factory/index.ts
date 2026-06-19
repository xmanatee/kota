/**
 * Module Factory Tool — router and public API.
 *
 * Implementation split into: definition, state, actions, logs.
 */

import { localWriteEffect } from "#core/tools/effect.js";
import type { ToolResult, ToolRunnerContext } from "#core/tools/index.js";
import { handleCreate, handleInfo, handleList, handleRemove } from "./actions.js";
import { moduleFactoryTool } from "./definition.js";
import { handleLogs } from "./logs.js";

// Public API
export { moduleFactoryTool } from "./definition.js";
export {
	addLoadedModule,
	loadedModuleCount,
	resetModuleFactory,
} from "./state.js";

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
	effect: localWriteEffect(),
};
