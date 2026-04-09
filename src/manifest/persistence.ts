/**
 * Manifest persistence — save, load, delete, and discover manifest-based modules.
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
import type { KotaModule } from "../module-types.js";
import { manifestToModule } from "./execution.js";
import type { ModuleManifest } from "./types.js";
import { validateManifest } from "./validation.js";

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
	const manifestPath = join(dir, "manifest.json");
	if (!existsSync(manifestPath)) return false;
	try {
		rmSync(manifestPath);
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
