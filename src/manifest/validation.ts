/**
 * Manifest validation — structural checks for agent-authored module manifests.
 */

import { getCoreRegistrations } from "../tools/index.js";
import type { ValidationError } from "./types.js";

const MODULE_NAME_RE = /^[a-z][a-z0-9_-]{1,48}[a-z0-9]$/;

const BUILTIN_MODULE_NAMES = new Set([
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

// Lazy to avoid circular dependency (tools/module-factory.ts → here → tools/index.ts → tools/module-factory.ts).
let _builtinToolNames: Set<string> | null = null;
function getBuiltinToolNames(): Set<string> {
	if (!_builtinToolNames) {
		_builtinToolNames = new Set([
			...getCoreRegistrations().map((r) => r.tool.name),
			"enable_tools",
			"memory",
			"schedule",
			"get_secret",
			"knowledge",
			"conversation_recall",
		]);
	}
	return _builtinToolNames;
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
	} else if (!MODULE_NAME_RE.test(m.name)) {
		errors.push({
			field: "name",
			message:
				"name must be 3-50 chars, lowercase letters/digits/hyphens/underscores",
		});
	} else if (BUILTIN_MODULE_NAMES.has(m.name)) {
		errors.push({
			field: "name",
			message: `"${m.name}" conflicts with a built-in module`,
		});
	}

	// Tools
	if (m.tools !== undefined) {
		validateTools(m.tools, errors);
	}

	// eventHandlers
	if (m.eventHandlers !== undefined) {
		validateEventHandlers(m.eventHandlers, errors);
	}

	// scripts
	if (m.scripts !== undefined) {
		validateScripts(m.scripts, errors);
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
		} else if (getBuiltinToolNames().has(t.name as string)) {
			errors.push({
				field: `${prefix}.name`,
				message: `"${t.name}" conflicts with a built-in tool`,
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

function validateSteps(
	steps: unknown[],
	prefix: string,
	errors: ValidationError[],
): void {
	for (let j = 0; j < steps.length; j++) {
		const s = steps[j] as Record<string, unknown>;
		const sp = `${prefix}.steps[${j}]`;
		if (!s || typeof s !== "object") {
			errors.push({ field: sp, message: "each step must be an object" });
			continue;
		}
		if (typeof s.tool !== "string" || !s.tool) {
			errors.push({ field: `${sp}.tool`, message: "step tool name is required" });
		}
		if (s.input !== undefined && (typeof s.input !== "object" || s.input === null || Array.isArray(s.input))) {
			errors.push({ field: `${sp}.input`, message: "step input must be an object" });
		}
		if (s.if !== undefined && typeof s.if !== "string") {
			errors.push({ field: `${sp}.if`, message: "step if must be a string" });
		}
	}
}

function validateEventHandlers(
	eventHandlers: unknown,
	errors: ValidationError[],
): void {
	if (!Array.isArray(eventHandlers)) {
		errors.push({ field: "eventHandlers", message: "eventHandlers must be an array" });
		return;
	}
	for (let i = 0; i < eventHandlers.length; i++) {
		const h = eventHandlers[i] as Record<string, unknown>;
		const prefix = `eventHandlers[${i}]`;
		if (!h || typeof h !== "object") {
			errors.push({ field: prefix, message: "each handler must be an object" });
			continue;
		}
		if (typeof h.event !== "string" || !h.event) {
			errors.push({ field: `${prefix}.event`, message: "event name is required" });
		}
		const hasCode = typeof h.code === "string" && h.code;
		const hasSteps = Array.isArray(h.steps) && h.steps.length > 0;
		if (!hasCode && !hasSteps) {
			errors.push({ field: `${prefix}`, message: "handler must have either code or steps" });
		}
		if (hasCode && hasSteps) {
			errors.push({ field: `${prefix}`, message: "handler cannot have both code and steps" });
		}
		if (hasCode) {
			if (h.language !== undefined && h.language !== "python" && h.language !== "node") {
				errors.push({ field: `${prefix}.language`, message: 'language must be "python" or "node"' });
			}
		}
		if (Array.isArray(h.steps)) {
			validateSteps(h.steps, prefix, errors);
		}
	}
}

function validateScripts(
	scripts: unknown,
	errors: ValidationError[],
): void {
	if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
		errors.push({ field: "scripts", message: "scripts must be an object" });
		return;
	}
	const scriptNameRe = /^[a-z][a-z0-9_-]{0,48}[a-z0-9]$/;
	for (const [sName, sDef] of Object.entries(scripts as Record<string, unknown>)) {
		const prefix = `scripts.${sName}`;
		if (!scriptNameRe.test(sName)) {
			errors.push({ field: prefix, message: "script name must be 2-50 chars, lowercase letters/digits/hyphens/underscores" });
		}
		if (!sDef || typeof sDef !== "object" || Array.isArray(sDef)) {
			errors.push({ field: prefix, message: "each script must be an object" });
			continue;
		}
		const sd = sDef as Record<string, unknown>;
		if (!Array.isArray(sd.steps) || sd.steps.length === 0) {
			errors.push({ field: `${prefix}.steps`, message: "script must have at least one step" });
		} else {
			validateSteps(sd.steps, prefix, errors);
		}
	}
}
