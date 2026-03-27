/**
 * Module Factory — CRUD action handlers (create, list, remove, info).
 */

import { resolveExtensionTools } from "../../extension-types.js";
import {
	deleteManifest,
	listManifestModules,
	loadManifest,
	type ModuleManifest,
	manifestToModule,
	saveManifest,
	validateManifest,
} from "../../manifest/index.js";
import type { ToolResult } from "../index.js";
import { deregisterModuleTools, registerTool } from "../index.js";
import {
	addLoadedModule,
	isModuleLoaded,
	loadedModuleCount,
	loadedModuleNames,
	MAX_MANIFEST_MODULES,
	removeLoadedModule,
} from "./state.js";

// ─── Create ──────────────────────────────────────────────────────────

export function handleCreate(
	rawManifest: Record<string, unknown> | undefined,
): ToolResult {
	if (!rawManifest) {
		return {
			content: "Error: manifest is required for create action",
			is_error: true,
		};
	}

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

	if (
		loadedModuleCount() >= MAX_MANIFEST_MODULES &&
		!isModuleLoaded(manifest.name)
	) {
		return {
			content: `Error: maximum ${MAX_MANIFEST_MODULES} custom modules reached. Remove one first.`,
			is_error: true,
		};
	}

	// If replacing, unload existing
	if (isModuleLoaded(manifest.name)) {
		deregisterModuleTools(manifest.name);
		removeLoadedModule(manifest.name);
	}

	// Convert to KotaExtension and register tools
	const mod = manifestToModule(manifest);
	const tools = resolveExtensionTools(mod);
	if (tools.length > 0) {
		for (const def of tools) {
			try {
				registerTool(def.tool, def.runner, manifest.name);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
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
		addLoadedModule(manifest.name);
		return {
			content:
				`Module "${manifest.name}" created (session-only — failed to persist: ${msg}). ` +
				`${tools.length} tool(s) registered.`,
		};
	}

	addLoadedModule(manifest.name);

	const toolNames = tools.map((t) => t.tool.name).join(", ") || "none";
	return {
		content:
			`Module "${manifest.name}" created and saved.\n` +
			`Tools: ${toolNames}\n` +
			`Version: ${manifest.version || "1.0.0"}`,
	};
}

// ─── List ────────────────────────────────────────────────────────────

export function handleList(): ToolResult {
	const saved = listManifestModules();

	if (saved.length === 0 && loadedModuleCount() === 0) {
		return {
			content:
				"No custom modules. Use module_factory(create, manifest: {...}) to create one.",
		};
	}

	const lines: string[] = [];
	const seen = new Set<string>();

	for (const { name, manifest } of saved) {
		seen.add(name);
		const loaded = isModuleLoaded(name);
		const toolCount = manifest.tools?.length || 0;
		const status = loaded ? "active" : "saved (loads on restart)";
		lines.push(
			`- ${name} v${manifest.version || "1.0.0"} [${status}]: ${manifest.description || "(no description)"} (${toolCount} tools)`,
		);
	}

	// Show session-only modules (created but not persisted)
	for (const name of loadedModuleNames()) {
		if (!seen.has(name)) {
			lines.push(`- ${name} [session-only]: (not persisted to disk)`);
		}
	}

	return {
		content: `Custom modules (${lines.length}):\n${lines.join("\n")}`,
	};
}

// ─── Remove ──────────────────────────────────────────────────────────

export function handleRemove(name: string | undefined): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for remove action",
			is_error: true,
		};
	}

	const wasLoaded = isModuleLoaded(name);
	const wasOnDisk = deleteManifest(name);

	if (!wasLoaded && !wasOnDisk) {
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	if (wasLoaded) {
		deregisterModuleTools(name);
		removeLoadedModule(name);
	}

	return {
		content: `Module "${name}" removed.${wasLoaded ? " Tools deregistered." : ""}${wasOnDisk ? " Manifest deleted from disk." : ""}`,
	};
}

// ─── Info ────────────────────────────────────────────────────────────

export function handleInfo(name: string | undefined): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for info action",
			is_error: true,
		};
	}

	const manifest = loadManifest(name);
	if (!manifest) {
		if (isModuleLoaded(name)) {
			return {
				content: `Module "${name}" is loaded (session-only, not persisted to disk).`,
			};
		}
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	const loaded = isModuleLoaded(name);
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

	if (manifest.dependencies && manifest.dependencies.length > 0) {
		parts.push(`Dependencies: ${manifest.dependencies.join(", ")}`);
	}

	return { content: parts.join("\n") };
}

