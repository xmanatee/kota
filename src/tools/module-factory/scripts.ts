/**
 * Module Factory — script execution handler.
 */

import { loadManifest, runModuleScript } from "../../manifest/index.js";
import type { ToolResult } from "../index.js";

export async function handleRun(
	name: string | undefined,
	scriptName: string | undefined,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	if (!name) {
		return {
			content: "Error: name is required for run action",
			is_error: true,
		};
	}
	if (!scriptName) {
		return {
			content: "Error: script is required for run action",
			is_error: true,
		};
	}

	const manifest = loadManifest(name);
	if (!manifest) {
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	if (!manifest.scripts || Object.keys(manifest.scripts).length === 0) {
		return {
			content: `Error: module "${name}" has no scripts`,
			is_error: true,
		};
	}

	const script = manifest.scripts[scriptName];
	if (!script) {
		const available = Object.keys(manifest.scripts).join(", ");
		return {
			content: `Error: no script "${scriptName}" in module "${name}". Available: ${available}`,
			is_error: true,
		};
	}

	return runModuleScript(name, script, args);
}
