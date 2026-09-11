import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { listModuleDirectories } from "#core/modules/module-files.js";
import { listAnchoredDirectory, readAnchoredTextFile, removeAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { loadManifest, saveManifest } from "./persistence.js";
import type { ModuleManifest } from "./types.js";
import { isManifestModuleName, validateManifest } from "./validation.js";

/** One-way conversion before trusted module discovery; never a second runtime loader. */
export function migrateSavedTools(scopeRoot: string): void {
  const directory = join(scopeRoot, ".kota", "tools");
  for (const entry of listAnchoredDirectory({ rootPath: scopeRoot, boundaryDir: directory, directoryPath: directory })) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const name = entry.name.slice(0, -5);
    if (!isManifestModuleName(name)) throw new Error(`Invalid saved tool filename: ${entry.name}`);
    const source = join(directory, entry.name);
    const access = { rootPath: scopeRoot, boundaryDir: directory, filePath: source };
    const file = readAnchoredTextFile(access);
    if (file === null) throw new Error(`Saved tool disappeared: ${source}`);
    const raw: unknown = JSON.parse(file.content);
    const candidate = { name, tools: [raw] };
    const errors = validateManifest(candidate);
    if (errors.length || (raw as { name: string }).name !== name) {
      throw new Error(`Cannot convert saved tool ${source}: ${errors.map((e) => e.message).join("; ") || "filename and tool name differ"}`);
    }
    const manifest = candidate as ModuleManifest;
    if (listModuleDirectories(scopeRoot).includes(name)) {
      // An identical target means a previous conversion committed before source removal.
      if (!isDeepStrictEqual(loadManifest(name, scopeRoot), manifest)) {
        throw new Error(`Cannot convert ${source}: module ${name} already exists`);
      }
    } else {
      saveManifest(manifest, scopeRoot);
    }
    removeAnchoredTextFile({ ...access, expectedSnapshot: file.snapshot });
  }
}
