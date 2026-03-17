/**
 * Module Factory Tool — lets the agent create, list, remove, and inspect
 * custom modules at runtime. Modules bundle multiple tools, prompt sections,
 * and metadata into a single self-contained unit.
 *
 * Unlike custom_tool (which creates individual tools), module_factory creates
 * full KotaModule instances with persistence, prompt sections, and module-level
 * organization. This enables the agent to extend its own capabilities in a
 * structured, reusable way.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
	deleteManifest,
	listManifestModules,
	loadManifest,
	type ModuleManifest,
	manifestToModule,
	saveManifest,
	validateManifest,
} from "../module-factory.js";
import { resolveModuleTools } from "../module-types.js";
import type { ToolResult } from "./index.js";
import { deregisterModuleTools, registerTool } from "./index.js";

// ─── State ───────────────────────────────────────────────────────────

/** Track which manifest modules are currently loaded in this session. */
const loadedManifestModules = new Set<string>();

const MAX_MANIFEST_MODULES = 10;

// ─── Tool Definition ─────────────────────────────────────────────────

export const moduleFactoryTool: Anthropic.Tool = {
	name: "module_factory",
	description:
		"Create, list, remove, or inspect custom modules. " +
		"Modules bundle related tools, prompt sections, and metadata — " +
		"more structured than custom_tool. " +
		"Modules persist to disk and auto-load on startup.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["create", "list", "remove", "info"],
				description:
					"create: define a new module. list: show all custom modules. " +
					"remove: unload and delete. info: show details of one module.",
			},
			manifest: {
				type: "object",
				description:
					'Module manifest (for create). Must include "name" (string). ' +
					'Optional: "description", "version", "tools" (array), "promptSection" (string), "dependencies" (array).',
			},
			name: {
				type: "string",
				description: "Module name (for remove/info actions)",
			},
		},
		required: ["action"],
	},
};

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
		default:
			return {
				content: `Unknown action: "${action}". Use create, list, remove, or info.`,
				is_error: true,
			};
	}
}

// ─── Create ──────────────────────────────────────────────────────────

function handleCreate(
	rawManifest: Record<string, unknown> | undefined,
): ToolResult {
	if (!rawManifest) {
		return {
			content: "Error: manifest is required for create action",
			is_error: true,
		};
	}

	// Validate
	const errors = validateManifest(rawManifest);
	if (errors.length > 0) {
		const details = errors
			.map((e) => `  ${e.field}: ${e.message}`)
			.join("\n");
		return {
			content: `Manifest validation failed:\n${details}`,
			is_error: true,
		};
	}

	const manifest = rawManifest as unknown as ModuleManifest;

	// Check limit
	if (
		loadedManifestModules.size >= MAX_MANIFEST_MODULES &&
		!loadedManifestModules.has(manifest.name)
	) {
		return {
			content: `Error: maximum ${MAX_MANIFEST_MODULES} custom modules reached. Remove one first.`,
			is_error: true,
		};
	}

	// If replacing, unload existing
	if (loadedManifestModules.has(manifest.name)) {
		deregisterModuleTools(manifest.name);
		loadedManifestModules.delete(manifest.name);
	}

	// Convert to KotaModule and register tools
	const mod = manifestToModule(manifest);
	const tools = resolveModuleTools(mod);
	if (tools.length > 0) {
		for (const def of tools) {
			try {
				registerTool(def.tool, def.runner, manifest.name);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				// Rollback already-registered tools on failure
				deregisterModuleTools(manifest.name);
				return {
					content: `Error registering tool "${def.tool.name}": ${msg}`,
					is_error: true,
				};
			}
		}
	}

	// Persist to disk
	try {
		saveManifest(manifest);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// Tools are registered but manifest not saved — still usable this session
		loadedManifestModules.add(manifest.name);
		return {
			content:
				`Module "${manifest.name}" created (session-only — failed to persist: ${msg}). ` +
				`${tools.length} tool(s) registered.`,
		};
	}

	loadedManifestModules.add(manifest.name);

	const toolNames = tools.map((t) => t.tool.name).join(", ") || "none";
	const promptNote = manifest.promptSection
		? " Prompt section will be active on next session."
		: "";
	return {
		content:
			`Module "${manifest.name}" created and saved.\n` +
			`Tools: ${toolNames}\n` +
			`Version: ${manifest.version || "1.0.0"}` +
			`${promptNote}`,
	};
}

// ─── List ────────────────────────────────────────────────────────────

function handleList(): ToolResult {
	const saved = listManifestModules();

	if (saved.length === 0 && loadedManifestModules.size === 0) {
		return {
			content:
				"No custom modules. Use module_factory(create, manifest: {...}) to create one.",
		};
	}

	const lines: string[] = [];
	const seen = new Set<string>();

	for (const { name, manifest } of saved) {
		seen.add(name);
		const loaded = loadedManifestModules.has(name);
		const toolCount = manifest.tools?.length || 0;
		const status = loaded ? "active" : "saved (loads on restart)";
		lines.push(
			`- ${name} v${manifest.version || "1.0.0"} [${status}]: ${manifest.description || "(no description)"} (${toolCount} tools)`,
		);
	}

	// Show session-only modules (created but not persisted)
	for (const name of loadedManifestModules) {
		if (!seen.has(name)) {
			lines.push(`- ${name} [session-only]: (not persisted to disk)`);
		}
	}

	return {
		content: `Custom modules (${lines.length}):\n${lines.join("\n")}`,
	};
}

// ─── Remove ──────────────────────────────────────────────────────────

function handleRemove(name: string | undefined): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for remove action",
			is_error: true,
		};
	}

	const wasLoaded = loadedManifestModules.has(name);
	const wasOnDisk = deleteManifest(name);

	if (!wasLoaded && !wasOnDisk) {
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	if (wasLoaded) {
		deregisterModuleTools(name);
		loadedManifestModules.delete(name);
	}

	return {
		content: `Module "${name}" removed.${wasLoaded ? " Tools deregistered." : ""}${wasOnDisk ? " Manifest deleted from disk." : ""}`,
	};
}

// ─── Info ────────────────────────────────────────────────────────────

function handleInfo(name: string | undefined): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for info action",
			is_error: true,
		};
	}

	const manifest = loadManifest(name);
	if (!manifest) {
		if (loadedManifestModules.has(name)) {
			return {
				content: `Module "${name}" is loaded (session-only, not persisted to disk).`,
			};
		}
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	const loaded = loadedManifestModules.has(name);
	const parts: string[] = [
		`Module: ${manifest.name}`,
		`Version: ${manifest.version || "1.0.0"}`,
		`Description: ${manifest.description || "(none)"}`,
		`Status: ${loaded ? "active" : "saved (loads on restart)"}`,
	];

	if (manifest.tools && manifest.tools.length > 0) {
		parts.push(`\nTools (${manifest.tools.length}):`);
		for (const t of manifest.tools) {
			const params = t.parameters
				? Object.keys(
						(t.parameters as Record<string, unknown>).properties || {},
					)
				: [];
			const paramStr =
				params.length > 0 ? `(${params.join(", ")})` : "()";
			parts.push(
				`  - ${t.name}${paramStr} [${t.language || "python"}]: ${t.description}`,
			);
		}
	}

	if (manifest.promptSection) {
		const preview =
			manifest.promptSection.length > 200
				? `${manifest.promptSection.slice(0, 200)}...`
				: manifest.promptSection;
		parts.push(`\nPrompt section: ${preview}`);
	}

	if (manifest.dependencies && manifest.dependencies.length > 0) {
		parts.push(`Dependencies: ${manifest.dependencies.join(", ")}`);
	}

	return { content: parts.join("\n") };
}

// ─── Session lifecycle ───────────────────────────────────────────────

/** Track a module as loaded in this session (called during startup discovery). */
export function markModuleLoaded(name: string): void {
	loadedManifestModules.add(name);
}

/** Get count of loaded manifest modules. For testing. */
export function getLoadedManifestModuleCount(): number {
	return loadedManifestModules.size;
}

/** Clear state. For testing. */
export function resetModuleFactory(): void {
	loadedManifestModules.clear();
}
