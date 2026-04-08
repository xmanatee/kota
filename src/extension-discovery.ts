/**
 * Extension discovery — finds user-authored extensions under `.kota/extensions/`
 * and adapts their exports to KotaExtension format for loading via ExtensionLoader.
 *
 * All user extensions live under `.kota/extensions/<name>/`. Three packaging
 * variants are supported:
 *
 *   manifest.json   — JSON-defined tools via the extension manifest format.
 *   index.js / index.mjs — single-file code extension (direct import).
 *   package.json (with "main") — packaged extension (compiled TypeScript or npm-installed).
 *
 * Use `kota extension install <source>` to install extensions from npm, GitHub,
 * or a URL. Extensions installed via the CLI land in the correct directory
 * automatically.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KotaExtension } from "./extension-types.js";
import type { ExtensionManifest } from "./manifest/index.js";
import { manifestToExtension, validateManifest } from "./manifest/index.js";
import { adaptExport } from "./tool-adapters.js";

const EXTENSIONS_DIR = ".kota/extensions";

/**
 * Discover all user extensions from `.kota/extensions/`.
 * Returns KotaExtension[] ready for ExtensionLoader.loadAll().
 */
export async function discoverExtensions(cwd?: string, verbose = false): Promise<KotaExtension[]> {
  const base = cwd || process.cwd();
  const extensionsDir = resolve(base, EXTENSIONS_DIR);

  if (!existsSync(extensionsDir)) return [];

  const entries = readdirSync(extensionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const extensions: KotaExtension[] = [];

  for (const name of entries) {
    const extDir = join(extensionsDir, name);
    try {
      const ext = await loadExtensionDirectory(extDir, name);
      if (ext) extensions.push(ext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Extension "${name}" failed to load: ${msg}`);
    }
  }

  if (extensions.length > 0 && verbose) {
    const toolCount = extensions.reduce((n, ext) => n + (ext.tools?.length ?? 0), 0);
    console.error(`[kota] Discovered ${extensions.length} extension(s) with ${toolCount} tool(s)`);
  }

  return extensions;
}

/**
 * Load a single extension from its directory.
 * Checks for manifest.json, index.js/mjs, then package.json (in that order).
 * Returns null for empty or unrecognized directories.
 */
async function loadExtensionDirectory(dir: string, name: string): Promise<KotaExtension | null> {
  // 1. Manifest-based extension (JSON-defined tools)
  const manifestPath = join(dir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ExtensionManifest;
      const errors = validateManifest(manifest);
      if (errors.length > 0) {
        console.error(`[kota] Manifest extension "${name}" has validation errors, skipping`);
        return null;
      }
      return manifestToExtension(manifest);
    } catch {
      console.error(`[kota] Failed to parse manifest for extension "${name}", skipping`);
      return null;
    }
  }

  // 2. Single-file code extension (index.js or index.mjs at directory root)
  for (const entry of ["index.js", "index.mjs"]) {
    const entryPath = join(dir, entry);
    if (existsSync(entryPath)) {
      return importExtensionFile(entryPath, name);
    }
  }

  // 3. Packaged extension — resolved via package.json "main" or "exports" field.
  //    Covers compiled TypeScript extensions and npm-installed packages.
  const pkgJsonPath = join(dir, "package.json");
  if (existsSync(pkgJsonPath)) {
    const entryPath = resolvePackageEntry(dir, pkgJsonPath);
    if (entryPath) {
      return importExtensionFile(entryPath, name);
    }
  }

  return null;
}

/** Resolve the entry file path from a package.json "main" or "exports" field. */
function resolvePackageEntry(dir: string, pkgJsonPath: string): string | null {
  try {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      main?: string;
      exports?: unknown;
    };
    const main =
      pkgJson.exports != null
        ? (pkgJson.exports as Record<string, unknown>)["."] ?? pkgJson.main
        : pkgJson.main;
    if (!main) return null;
    const mainStr =
      typeof main === "string" ? main : ((main as Record<string, string>)?.default ?? (main as Record<string, string>)?.import ?? null);
    if (!mainStr) return null;
    const entryPath = join(dir, mainStr);
    return existsSync(entryPath) ? entryPath : null;
  } catch {
    return null;
  }
}

/** Import a single extension file and adapt its export to KotaExtension. */
async function importExtensionFile(absPath: string, displayName: string): Promise<KotaExtension> {
  const url = pathToFileURL(absPath).href;
  const imported = await import(url);
  return adaptExport(imported.default ?? imported, displayName);
}
