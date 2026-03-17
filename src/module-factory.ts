/**
 * Module Factory — creates KotaModule instances from declarative JSON manifests.
 *
 * This is the bridge between agent-authored module definitions (JSON) and the
 * ModuleLoader's KotaModule protocol. Manifests are saved to disk and
 * auto-discovered on startup, making agent-created modules persistent.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_TIMEOUT, MAX_OUTPUT } from "./code-wrappers.js";
import type { KotaModule, ToolDef } from "./module-types.js";
import type { Language } from "./repl-session.js";
import { sessions } from "./repl-session.js";
import type { ToolResult } from "./tools/index.js";

// ─── Manifest types ──────────────────────────────────────────────────

export type ManifestToolDef = {
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
	code: string;
	language?: Language;
	group?: string;
};

export type ManifestEventHandler = {
	/** Event name to subscribe to (e.g. "schedule:fire", "process:exit"). */
	event: string;
	/** Code to run when the event fires. Receives `event_name` and `payload` variables. */
	code: string;
	/** Language for code execution (default: "python"). */
	language?: Language;
};

export type ModuleManifest = {
	name: string;
	version?: string;
	description?: string;
	tools?: ManifestToolDef[];
	promptSection?: string;
	dependencies?: string[];
	/** Event handlers — subscribe to bus events and run code when they fire. */
	eventHandlers?: ManifestEventHandler[];
};

// ─── Validation ──────────────────────────────────────────────────────

const MODULE_NAME_RE = /^[a-z][a-z0-9_-]{1,48}[a-z0-9]$/;

const BUILTIN_MODULE_NAMES = new Set([
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

const BUILTIN_TOOL_NAMES = new Set([
	"shell",
	"file_read",
	"file_write",
	"file_edit",
	"multi_edit",
	"find_replace",
	"grep",
	"glob",
	"todo",
	"repo_map",
	"delegate",
	"web_fetch",
	"web_search",
	"ask_user",
	"http_request",
	"process",
	"code_exec",
	"notebook",
	"files_overview",
	"enable_tools",
	"custom_tool",
	"module_factory",
	"memory",
	"schedule",
	"get_secret",
	"knowledge",
	"checkpoint",
	"notify",
	"screenshot",
	"read_document",
	"clipboard",
]);

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;

export type ValidationError = { field: string; message: string };

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
		if (!Array.isArray(m.tools)) {
			errors.push({ field: "tools", message: "tools must be an array" });
		} else {
			const seen = new Set<string>();
			for (let i = 0; i < m.tools.length; i++) {
				const t = m.tools[i] as Record<string, unknown>;
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
				} else if (BUILTIN_TOOL_NAMES.has(t.name as string)) {
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
	}

	// eventHandlers
	if (m.eventHandlers !== undefined) {
		if (!Array.isArray(m.eventHandlers)) {
			errors.push({ field: "eventHandlers", message: "eventHandlers must be an array" });
		} else {
			for (let i = 0; i < m.eventHandlers.length; i++) {
				const h = m.eventHandlers[i] as Record<string, unknown>;
				const prefix = `eventHandlers[${i}]`;
				if (!h || typeof h !== "object") {
					errors.push({ field: prefix, message: "each handler must be an object" });
					continue;
				}
				if (typeof h.event !== "string" || !h.event) {
					errors.push({ field: `${prefix}.event`, message: "event name is required" });
				}
				if (typeof h.code !== "string" || !h.code) {
					errors.push({ field: `${prefix}.code`, message: "handler code is required" });
				}
				if (h.language !== undefined && h.language !== "python" && h.language !== "node") {
					errors.push({ field: `${prefix}.language`, message: 'language must be "python" or "node"' });
				}
			}
		}
	}

	// promptSection
	if (
		m.promptSection !== undefined &&
		typeof m.promptSection !== "string"
	) {
		errors.push({
			field: "promptSection",
			message: "promptSection must be a string",
		});
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

// ─── Manifest → KotaModule conversion ────────────────────────────────

function buildToolRunner(
	toolDef: ManifestToolDef,
): (input: Record<string, unknown>) => Promise<ToolResult> {
	const lang: Language = toolDef.language || "python";
	return async (input) => {
		const paramsJson = JSON.stringify(input);
		const b64 = Buffer.from(paramsJson).toString("base64");

		const wrapper =
			lang === "python"
				? `import json as __j, base64 as __b\nparams = __j.loads(__b.b64decode('${b64}').decode())\n${toolDef.code}`
				: `const params = JSON.parse(Buffer.from('${b64}','base64').toString());\n${toolDef.code}`;

		const session = sessions[lang];
		const { output, isError } = await session.execute(
			wrapper,
			DEFAULT_TIMEOUT,
		);

		const truncated =
			output.length > MAX_OUTPUT
				? `${output.slice(0, MAX_OUTPUT)}\n[truncated — ${output.length} chars total]`
				: output;

		return { content: truncated, is_error: isError };
	};
}

export function manifestToModule(manifest: ModuleManifest): KotaModule {
	const tools: ToolDef[] = (manifest.tools || []).map((t) => ({
		tool: {
			name: t.name,
			description: t.description,
			input_schema: (t.parameters || {
				type: "object" as const,
				properties: {},
			}) as Anthropic.Tool["input_schema"],
		},
		runner: buildToolRunner(t),
		group: t.group,
	}));

	const mod: KotaModule = {
		name: manifest.name,
		version: manifest.version || "1.0.0",
		description: manifest.description,
		dependencies: manifest.dependencies,
		tools: tools.length > 0 ? tools : undefined,
	};

	if (manifest.promptSection) {
		const section = manifest.promptSection;
		mod.promptSection = () => section;
	}

	if (manifest.eventHandlers && manifest.eventHandlers.length > 0) {
		const handlers = manifest.eventHandlers;
		mod.events = (bus) => {
			const unsubs: (() => void)[] = [];
			for (const handler of handlers) {
				const unsub = bus.on(handler.event, (payload) => {
					runEventHandler(manifest.name, handler, payload);
				});
				unsubs.push(unsub);
			}
			return unsubs;
		};
	}

	return mod;
}

/**
 * Execute a manifest event handler's code in a REPL session.
 * Injects `event_name` and `payload` variables into the code environment.
 * Errors are logged but never propagated — event handlers must not crash the bus.
 */
function runEventHandler(
	moduleName: string,
	handler: ManifestEventHandler,
	payload: Record<string, unknown>,
): void {
	const lang: Language = handler.language || "python";
	const payloadJson = JSON.stringify(payload);
	const b64 = Buffer.from(payloadJson).toString("base64");

	const wrapper =
		lang === "python"
			? `import json as __j, base64 as __b\nevent_name = ${JSON.stringify(handler.event)}\npayload = __j.loads(__b.b64decode('${b64}').decode())\n${handler.code}`
			: `const event_name = ${JSON.stringify(handler.event)};\nconst payload = JSON.parse(Buffer.from('${b64}','base64').toString());\n${handler.code}`;

	const session = sessions[lang];
	session.execute(wrapper, DEFAULT_TIMEOUT).then(
		({ output, isError }) => {
			if (isError) {
				console.error(`[module:${moduleName}] Event handler error (${handler.event}): ${output}`);
			} else if (output.trim()) {
				console.error(`[module:${moduleName}] Event handler (${handler.event}): ${output.trim()}`);
			}
		},
		(err) => {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[module:${moduleName}] Event handler failed (${handler.event}): ${msg}`);
		},
	);
}

// ─── Persistence ─────────────────────────────────────────────────────

function getModulesDir(cwd?: string): string {
	return join(cwd || process.cwd(), ".kota", "modules");
}

function getManifestPath(moduleName: string, cwd?: string): string {
	return join(getModulesDir(cwd), moduleName, "manifest.json");
}

export function saveManifest(
	manifest: ModuleManifest,
	cwd?: string,
): string {
	const dir = join(getModulesDir(cwd), manifest.name);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const path = join(dir, "manifest.json");
	writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
	return path;
}

export function loadManifest(
	moduleName: string,
	cwd?: string,
): ModuleManifest | null {
	const path = getManifestPath(moduleName, cwd);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ModuleManifest;
	} catch {
		return null;
	}
}

export function deleteManifest(moduleName: string, cwd?: string): boolean {
	const dir = join(getModulesDir(cwd), moduleName);
	if (!existsSync(dir)) return false;
	// Only delete manifest.json, leave storage files intact
	const manifestPath = join(dir, "manifest.json");
	if (!existsSync(manifestPath)) return false;
	try {
		rmSync(manifestPath);
		// Clean up dir if empty (only manifest was there)
		const remaining = readdirSync(dir);
		if (remaining.length === 0) rmSync(dir, { recursive: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Discover all manifest-based modules saved to `.kota/modules/`.
 * Returns KotaModule[] ready for ModuleLoader.loadAll().
 */
export function discoverManifestModules(cwd?: string): KotaModule[] {
	const dir = getModulesDir(cwd);
	if (!existsSync(dir)) return [];

	const modules: KotaModule[] = [];
	for (const entry of readdirSync(dir)) {
		const manifestPath = join(dir, entry, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const raw = readFileSync(manifestPath, "utf-8");
			const manifest = JSON.parse(raw) as ModuleManifest;
			const errors = validateManifest(manifest);
			if (errors.length > 0) {
				console.error(
					`[kota] Manifest module "${entry}" has validation errors, skipping`,
				);
				continue;
			}
			modules.push(manifestToModule(manifest));
		} catch {
			console.error(
				`[kota] Failed to load manifest module "${entry}", skipping`,
			);
		}
	}
	return modules;
}

/** List all saved manifest module names. */
export function listManifestModules(
	cwd?: string,
): { name: string; manifest: ModuleManifest }[] {
	const dir = getModulesDir(cwd);
	if (!existsSync(dir)) return [];

	const results: { name: string; manifest: ModuleManifest }[] = [];
	for (const entry of readdirSync(dir)) {
		const manifest = loadManifest(entry, cwd);
		if (manifest) results.push({ name: entry, manifest });
	}
	return results;
}
