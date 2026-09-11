/**
 * Manifest persistence — save, load, delete, and list manifest-based modules.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { ModuleManifest } from "./types.js";
import { isManifestModuleName, validateManifest } from "./validation.js";

function getModulesDir(cwd?: string): string {
	return resolve(cwd || process.cwd(), ".kota", "modules");
}

export function getManifestPath(moduleName: string, cwd?: string): string {
	if (!isManifestModuleName(moduleName))
		throw new Error(`Invalid module name: ${moduleName}`);
	return join(getModulesDir(cwd), moduleName, "manifest.json");
}

export function saveManifest(manifest: ModuleManifest, cwd?: string): string {
	const path = getManifestPath(manifest.name, cwd);
	writeJsonFileAtomic(path, manifest);
	return path;
}

export function loadManifest(
	moduleName: string,
	cwd?: string,
): ModuleManifest | null {
	const path = getManifestPath(moduleName, cwd);
	if (!existsSync(path)) return null;
	const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
	const errors = validateManifest(raw);
	if (errors.length)
		throw new Error(
			`Invalid module manifest ${path}: ${errors.map((error) => error.message).join("; ")}`,
		);
	const manifest = raw as ModuleManifest;
	if (manifest.name !== moduleName)
		throw new Error(`Module name does not match its directory: ${path}`);
	return manifest;
}

export function deleteManifest(moduleName: string, cwd?: string): boolean {
	const manifestPath = getManifestPath(moduleName, cwd);
	if (!existsSync(manifestPath)) return false;
	rmSync(manifestPath);
	const dir = join(getModulesDir(cwd), moduleName);
	if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
	return true;
}

/** List all saved manifest module names. */
export function listManifestModules(
	cwd?: string,
): { name: string; manifest: ModuleManifest }[] {
	const dir = getModulesDir(cwd);
	if (!existsSync(dir)) return [];

	const results: { name: string; manifest: ModuleManifest }[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifest = loadManifest(entry.name, cwd);
		if (manifest) results.push({ name: entry.name, manifest });
	}
	return results;
}
