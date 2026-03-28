/**
 * Extension Factory — CRUD action handlers (create, list, remove, info).
 */

import { resolveExtensionTools } from "../../extension-types.js";
import {
	deleteManifest,
	type ExtensionManifest,
	listManifestExtensions,
	loadManifest,
	manifestToExtension,
	saveManifest,
	validateManifest,
} from "../../manifest/index.js";
import type { ToolResult } from "../index.js";
import { deregisterExtensionTools, registerTool } from "../index.js";
import {
	addLoadedExtension,
	isExtensionLoaded,
	loadedExtensionCount,
	loadedExtensionNames,
	MAX_MANIFEST_EXTENSIONS,
	removeLoadedExtension,
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

	const manifest = rawManifest as unknown as ExtensionManifest;

	if (
		loadedExtensionCount() >= MAX_MANIFEST_EXTENSIONS &&
		!isExtensionLoaded(manifest.name)
	) {
		return {
			content: `Error: maximum ${MAX_MANIFEST_EXTENSIONS} custom extensions reached. Remove one first.`,
			is_error: true,
		};
	}

	// If replacing, unload existing
	if (isExtensionLoaded(manifest.name)) {
		deregisterExtensionTools(manifest.name);
		removeLoadedExtension(manifest.name);
	}

	// Convert to KotaExtension and register tools
	const mod = manifestToExtension(manifest);
	const tools = resolveExtensionTools(mod);
	if (tools.length > 0) {
		for (const def of tools) {
			try {
				registerTool(def.tool, def.runner, manifest.name);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				deregisterExtensionTools(manifest.name);
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
		addLoadedExtension(manifest.name);
		return {
			content:
				`Extension "${manifest.name}" created (session-only — failed to persist: ${msg}). ` +
				`${tools.length} tool(s) registered.`,
		};
	}

	addLoadedExtension(manifest.name);

	const toolNames = tools.map((t) => t.tool.name).join(", ") || "none";
	return {
		content:
			`Extension "${manifest.name}" created and saved.\n` +
			`Tools: ${toolNames}\n` +
			`Version: ${manifest.version || "1.0.0"}`,
	};
}

// ─── List ────────────────────────────────────────────────────────────

export function handleList(): ToolResult {
	const saved = listManifestExtensions();

	if (saved.length === 0 && loadedExtensionCount() === 0) {
		return {
			content:
				"No custom extensions. Use extension_factory(create, manifest: {...}) to create one.",
		};
	}

	const lines: string[] = [];
	const seen = new Set<string>();

	for (const { name, manifest } of saved) {
		seen.add(name);
		const loaded = isExtensionLoaded(name);
		const toolCount = manifest.tools?.length || 0;
		const status = loaded ? "active" : "saved (loads on restart)";
		lines.push(
			`- ${name} v${manifest.version || "1.0.0"} [${status}]: ${manifest.description || "(no description)"} (${toolCount} tools)`,
		);
	}

	// Show session-only extensions (created but not persisted)
	for (const name of loadedExtensionNames()) {
		if (!seen.has(name)) {
			lines.push(`- ${name} [session-only]: (not persisted to disk)`);
		}
	}

	return {
		content: `Custom extensions (${lines.length}):\n${lines.join("\n")}`,
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

	const wasLoaded = isExtensionLoaded(name);
	const wasOnDisk = deleteManifest(name);

	if (!wasLoaded && !wasOnDisk) {
		return {
			content: `Error: no custom extension named "${name}"`,
			is_error: true,
		};
	}

	if (wasLoaded) {
		deregisterExtensionTools(name);
		removeLoadedExtension(name);
	}

	return {
		content: `Extension "${name}" removed.${wasLoaded ? " Tools deregistered." : ""}${wasOnDisk ? " Manifest deleted from disk." : ""}`,
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
		if (isExtensionLoaded(name)) {
			return {
				content: `Extension "${name}" is loaded (session-only, not persisted to disk).`,
			};
		}
		return {
			content: `Error: no custom extension named "${name}"`,
			is_error: true,
		};
	}

	const loaded = isExtensionLoaded(name);
	const parts: string[] = [
		`Extension: ${manifest.name}`,
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
