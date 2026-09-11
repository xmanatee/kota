/**
 * Module Factory — CRUD action handlers (create, list, remove, info).
 */

import {
	deleteManifest,
	listManifestModules,
	loadManifest,
	type ModuleManifest,
	saveManifest,
	validateManifest,
} from "#core/manifest/index.js";
import type { ToolResult } from "#core/tools/tool-registry.js";
// ─── Create ──────────────────────────────────────────────────────────

export function handleCreate(
	rawManifest: Record<string, unknown> | undefined,
	cwd?: string,
): ToolResult {
	if (!rawManifest) {
		return {
			content: "Error: manifest is required for create action",
			is_error: true,
		};
	}

	const errors = validateManifest(rawManifest);
	if (errors.length > 0) {
		const details = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
		return {
			content: `Manifest validation failed:\n${details}`,
			is_error: true,
		};
	}

	const manifest = rawManifest as unknown as ModuleManifest;

	try {
		saveManifest(manifest, cwd);
	} catch (error) {
		return {
			content: `Failed to save module "${manifest.name}": ${error instanceof Error ? error.message : String(error)}`,
			is_error: true,
		};
	}
	const toolNames =
		manifest.tools?.map((tool) => tool.name).join(", ") || "none";
	return {
		content: `Module "${manifest.name}" saved. Changes take effect when the runtime next loads modules.\nTools: ${toolNames}\nVersion: ${manifest.version || "1.0.0"}`,
	};
}

export function handleList(cwd?: string): ToolResult {
	const saved = listManifestModules(cwd);
	if (saved.length === 0)
		return {
			content:
				"No custom modules. Use module_factory(create, manifest: {...}) to create one.",
		};
	const lines = saved.map(
		({ name, manifest }) =>
			`- ${name} v${manifest.version || "1.0.0"} [saved]: ${manifest.description || "(no description)"} (${manifest.tools?.length ?? 0} tools)`,
	);
	return {
		content: `Saved custom modules (${lines.length}):\n${lines.join("\n")}`,
	};
}

// ─── Remove ──────────────────────────────────────────────────────────

export function handleRemove(
	name: string | undefined,
	cwd?: string,
): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for remove action",
			is_error: true,
		};
	}

	if (!deleteManifest(name, cwd)) {
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}
	return {
		content: `Module "${name}" manifest removed. Changes take effect when the runtime next loads modules.`,
	};
}

// ─── Info ────────────────────────────────────────────────────────────

export function handleInfo(name: string | undefined, cwd?: string): ToolResult {
	if (!name) {
		return {
			content: "Error: name is required for info action",
			is_error: true,
		};
	}

	const manifest = loadManifest(name, cwd);
	if (!manifest) {
		return {
			content: `Error: no custom module named "${name}"`,
			is_error: true,
		};
	}

	const parts: string[] = [
		`Module: ${manifest.name}`,
		`Version: ${manifest.version || "1.0.0"}`,
		`Description: ${manifest.description || "(none)"}`,
		"Status: saved",
	];

	if (manifest.tools && manifest.tools.length > 0) {
		parts.push(`\nTools (${manifest.tools.length}):`);
		for (const t of manifest.tools) {
			const params = t.parameters
				? Object.keys(
						(t.parameters as Record<string, unknown>).properties || {},
					)
				: [];
			const paramStr = params.length > 0 ? `(${params.join(", ")})` : "()";
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
