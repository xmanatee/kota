import { join, resolve } from "node:path";
import type { FileAccess } from "#core/util/filesystem/anchored-file-protocol.js";
import { listAnchoredDirectory } from "#core/util/filesystem/anchored-files.js";

// Storage includes installed package identities (such as audit.probe) and runtime
// names (such as _default). Preserve their spelling as one lossless path component;
// authored manifests impose their own narrower naming policy.
export function assertModuleStorageName(name: string): void {
  if (!isModulePathComponent(name)) throw new Error(`Invalid module name: ${name}`);
}

export function assertModuleFilename(filename: string): void {
  if (!isModulePathComponent(filename)) {
    throw new Error(`Invalid module filename: ${filename}`);
  }
}

function isModulePathComponent(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value !== "." && value !== ".." &&
    !/[/\\\0]/.test(value) && Buffer.from(value, "utf8").toString("utf8") === value;
}

export function moduleDirectory(scopeRoot: string, name: string): string {
  assertModuleStorageName(name);
  return resolve(scopeRoot, ".kota", "modules", name);
}

/** Path selection only. Every I/O consumer must pass this to the anchored owner. */
export function moduleFile(scopeRoot: string, name: string, filename: string): FileAccess {
  const boundaryDir = moduleDirectory(scopeRoot, name);
  assertModuleFilename(filename);
  return { rootPath: resolve(scopeRoot), boundaryDir, filePath: join(boundaryDir, filename) };
}

export function listModuleDirectories(scopeRoot: string): string[] {
  const directoryPath = resolve(scopeRoot, ".kota", "modules");
  return listAnchoredDirectory({ rootPath: scopeRoot, boundaryDir: directoryPath, directoryPath })
    .filter(entry => entry.kind === "directory")
    .map(entry => { assertModuleStorageName(entry.name); return entry.name; });
}
