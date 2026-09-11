/**
 * Manifest persistence — save, load, delete, and list manifest-based modules.
 */

import { listModuleDirectories, moduleFile } from "#core/modules/module-files.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleManifest } from "./types.js";
import { isManifestModuleName, validateManifest } from "./validation.js";

export function getManifestPath(moduleName: string, cwd?: string): string {
	if (!isManifestModuleName(moduleName))
		throw new Error(`Invalid module name: ${moduleName}`);
	return moduleFile(cwd ?? process.cwd(), moduleName, "manifest.json").filePath;
}

export function saveManifest(manifest: ModuleManifest, cwd?: string): string {
	const path = getManifestPath(manifest.name, cwd);
	new ModuleStorage(cwd ?? process.cwd(), manifest.name).writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
	return path;
}

export function loadManifest(
	moduleName: string,
	cwd?: string,
): ModuleManifest | null {
	const path = getManifestPath(moduleName, cwd);
	const content = new ModuleStorage(cwd ?? process.cwd(), moduleName).readFile("manifest.json");
	if (content === undefined) return null;
	const raw: unknown = JSON.parse(content);
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
  getManifestPath(moduleName, cwd);
  // Keep the directory: it is shared with runtime storage and may receive files
  // concurrently. No recursive pathname cleanup after the anchored deletion.
  return new ModuleStorage(cwd ?? process.cwd(), moduleName).deleteFile("manifest.json");
}

/** List all saved manifest module names. */
export function listManifestModules(
	cwd?: string,
): { name: string; manifest: ModuleManifest }[] {
  const results: { name: string; manifest: ModuleManifest }[] = [];
  for (const name of listModuleDirectories(cwd ?? process.cwd())) {
    if (!new ModuleStorage(cwd ?? process.cwd(), name).hasFile("manifest.json")) continue;
    const manifest = loadManifest(name, cwd);
    if (manifest) results.push({ name, manifest });
  }
  return results;
}
