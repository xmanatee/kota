/**
 * Manifest validation — structural checks for agent-authored module manifests.
 */

import { isMcpManagedToolName, mcpManagedToolNameError } from "#core/tools/tool-name-policy.js";
import { getCoreRegistrations } from "#core/tools/tool-registry.js";
import type { ValidationError } from "./types.js";

const MODULE_NAME_RE = /^[a-z][a-z0-9_-]{1,48}[a-z0-9]$/;
export function isManifestModuleName(value: string): boolean {
  return MODULE_NAME_RE.test(value);
}

const RESERVED_MODULE_NAMES = new Set([
	"working-memory",
	"secrets",
	"memory",
	"knowledge",
	"scheduler",
	"telegram",
	"daemon",
	"vercel-adapter",
	"web",
	"registry",
]);

function getReservedToolNames(): Set<string> {
	return new Set([
			...getCoreRegistrations().map((r) => r.tool.name),
			// Execution module tools (always loaded with the installed module set)
			"shell", "process", "code_exec", "computer_use", "screenshot",
			// Filesystem module tools (always loaded with the installed module set)
			"file_read", "file_write", "file_edit", "multi_edit", "find_replace",
			"glob", "grep", "file_watch", "files_overview",
			// Web access module tools (always loaded with the installed module set)
			"web_fetch", "web_search", "http_request",
			// Other repo module tools
			"enable_tools",
			"memory",
			"schedule",
			"get_secret",
			"knowledge",
			"conversation_recall",
	]);
}

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;

export function validateManifest(manifest: unknown): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		return [{ field: "root", message: "Manifest must be a JSON object" }];
	}
	const m = manifest as Record<string, unknown>;

	// Name
	if (typeof m.name !== "string" || !m.name) {
		errors.push({ field: "name", message: "name is required (string)" });
	} else if (!isManifestModuleName(m.name)) {
		errors.push({
			field: "name",
			message:
				"name must be 3-50 chars, lowercase letters/digits/hyphens/underscores",
		});
	} else if (RESERVED_MODULE_NAMES.has(m.name)) {
		errors.push({
			field: "name",
			message: `"${m.name}" conflicts with an installed module`,
		});
	}

	// Tools
	if (m.tools !== undefined) {
		validateTools(m.tools, errors);
	}

	// dependencies
	if (m.dependencies !== undefined) {
		if (
			!Array.isArray(m.dependencies) ||
			!m.dependencies.every((d: unknown) => typeof d === "string")
		) {
			errors.push({
				field: "dependencies",
				message: "dependencies must be an array of strings",
			});
		}
	}

	return errors;
}

function validateTools(tools: unknown, errors: ValidationError[]): void {
	if (!Array.isArray(tools)) {
		errors.push({ field: "tools", message: "tools must be an array" });
		return;
	}
	const seen = new Set<string>();
	for (let i = 0; i < tools.length; i++) {
		const t = tools[i] as Record<string, unknown>;
		const prefix = `tools[${i}]`;
		if (!t || typeof t !== "object") {
			errors.push({
				field: prefix,
				message: "each tool must be an object",
			});
			continue;
		}
		if (typeof t.name !== "string" || !t.name) {
			errors.push({
				field: `${prefix}.name`,
				message: "tool name is required",
			});
		} else if (!TOOL_NAME_RE.test(t.name as string)) {
			errors.push({
				field: `${prefix}.name`,
				message: "tool name must be snake_case, 3-50 chars",
			});
		} else if (isMcpManagedToolName(t.name as string)) {
			errors.push({
				field: `${prefix}.name`,
				message: mcpManagedToolNameError(t.name as string),
			});
		} else if (getReservedToolNames().has(t.name as string)) {
			errors.push({
				field: `${prefix}.name`,
				message: `"${t.name}" conflicts with an installed tool`,
			});
		} else if (seen.has(t.name as string)) {
			errors.push({
				field: `${prefix}.name`,
				message: `duplicate tool name "${t.name}"`,
			});
		} else {
			seen.add(t.name as string);
		}
		if (typeof t.description !== "string" || !t.description) {
			errors.push({
				field: `${prefix}.description`,
				message: "tool description is required",
			});
		}
		if (typeof t.code !== "string" || !t.code) {
			errors.push({
				field: `${prefix}.code`,
				message: "tool code is required",
			});
		}
		if (
			t.language !== undefined &&
			t.language !== "python" &&
			t.language !== "node"
		) {
			errors.push({
				field: `${prefix}.language`,
				message: 'language must be "python" or "node"',
			});
		}
		if (t.parameters !== undefined) {
			if (
				typeof t.parameters !== "object" ||
				t.parameters === null ||
				Array.isArray(t.parameters)
			) {
				errors.push({
					field: `${prefix}.parameters`,
					message: "parameters must be a JSON Schema object",
				});
			} else {
				const p = t.parameters as Record<string, unknown>;
				if (p.type !== "object") {
					errors.push({
						field: `${prefix}.parameters`,
						message: 'parameters.type must be "object"',
					});
				}
			}
		}
	}
}
