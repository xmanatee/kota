/**
 * Manifest persistence — save, load, delete, and discover manifest-based extensions.
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
import type { KotaExtension } from "../extension-types.js";
import { manifestToExtension } from "./execution.js";
import type { ExtensionManifest } from "./types.js";
import { validateManifest } from "./validation.js";

function getExtensionsDir(cwd?: string): string {
	return join(cwd || process.cwd(), ".kota", "extensions");
}

function getManifestPath(extensionName: string, cwd?: string): string {
	return join(getExtensionsDir(cwd), extensionName, "manifest.json");
}

export function saveManifest(
	manifest: ExtensionManifest,
	cwd?: string,
): string {
	const dir = join(getExtensionsDir(cwd), manifest.name);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const path = join(dir, "manifest.json");
	writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
	return path;
}

export function loadManifest(
	extensionName: string,
	cwd?: string,
): ExtensionManifest | null {
	const path = getManifestPath(extensionName, cwd);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ExtensionManifest;
	} catch {
		return null;
	}
}

export function deleteManifest(extensionName: string, cwd?: string): boolean {
	const dir = join(getExtensionsDir(cwd), extensionName);
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
 * Discover all manifest-based extensions saved to `.kota/extensions/`.
 * Returns KotaExtension[] ready for ExtensionLoader.loadAll().
 */
export function discoverManifestExtensions(cwd?: string): KotaExtension[] {
	const dir = getExtensionsDir(cwd);
	if (!existsSync(dir)) return [];

	const extensions: KotaExtension[] = [];
	for (const entry of readdirSync(dir)) {
		const manifestPath = join(dir, entry, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const raw = readFileSync(manifestPath, "utf-8");
			const manifest = JSON.parse(raw) as ExtensionManifest;
			const errors = validateManifest(manifest);
			if (errors.length > 0) {
				console.error(
					`[kota] Manifest extension "${entry}" has validation errors, skipping`,
				);
				continue;
			}
			extensions.push(manifestToExtension(manifest));
		} catch {
			console.error(
				`[kota] Failed to load manifest extension "${entry}", skipping`,
			);
		}
	}
	return extensions;
}

/** List all saved manifest extension names. */
export function listManifestExtensions(
	cwd?: string,
): { name: string; manifest: ExtensionManifest }[] {
	const dir = getExtensionsDir(cwd);
	if (!existsSync(dir)) return [];

	const results: { name: string; manifest: ExtensionManifest }[] = [];
	for (const entry of readdirSync(dir)) {
		const manifest = loadManifest(entry, cwd);
		if (manifest) results.push({ name: entry, manifest });
	}
	return results;
}
