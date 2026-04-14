/**
 * Module discovery — finds user-authored modules under `.kota/modules/`
 * and adapts their exports to KotaModule format for loading via ModuleLoader.
 *
 * All user modules live under `.kota/modules/<name>/`. Three packaging
 * variants are supported:
 *
 *   manifest.json   — JSON-defined tools via the module manifest format.
 *   index.js / index.mjs — single-file code module (direct import).
 *   package.json (with "main") — packaged module (compiled TypeScript or npm-installed).
 *
 * Use `kota module install <source>` to install modules from npm, GitHub,
 * or a URL. Modules installed via the CLI land in the correct directory
 * automatically.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleManifest } from "#core/manifest/index.js";
import { manifestToModule, validateManifest } from "#core/manifest/index.js";
import { adaptExport } from "#core/tools/tool-adapters.js";
import type { KotaModule } from "./module-types.js";

const MODULES_DIR = ".kota/modules";

/**
 * Discover all user modules from `.kota/modules/`.
 * Returns KotaModule[] ready for ModuleLoader.loadAll().
 */
export async function discoverModules(cwd?: string, verbose = false): Promise<KotaModule[]> {
  const base = cwd || process.cwd();
  const modulesDir = resolve(base, MODULES_DIR);

  if (!existsSync(modulesDir)) return [];

  const entries = readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const modules: KotaModule[] = [];

  for (const name of entries) {
    const moduleDir = join(modulesDir, name);
    try {
      const module = await loadModuleDirectory(moduleDir, name);
      if (module) modules.push(module);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Module "${name}" failed to load: ${msg}`);
    }
  }

  if (modules.length > 0 && verbose) {
    const toolCount = modules.reduce((n, module) => n + (module.tools?.length ?? 0), 0);
    console.error(`[kota] Discovered ${modules.length} module(s) with ${toolCount} tool(s)`);
  }

  return modules;
}

/**
 * Load a single module from its directory.
 * Checks for manifest.json, index.js/mjs, then package.json (in that order).
 * Returns null for empty or unrecognized directories.
 */
async function loadModuleDirectory(dir: string, name: string): Promise<KotaModule | null> {
  // 1. Manifest-based module (JSON-defined tools)
  const manifestPath = join(dir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ModuleManifest;
      const errors = validateManifest(manifest);
      if (errors.length > 0) {
        console.error(`[kota] Manifest module "${name}" has validation errors, skipping`);
        return null;
      }
      return manifestToModule(manifest);
    } catch {
      console.error(`[kota] Failed to parse manifest for module "${name}", skipping`);
      return null;
    }
  }

  // 2. Single-file code module (index.js or index.mjs at directory root)
  for (const entry of ["index.js", "index.mjs"]) {
    const entryPath = join(dir, entry);
    if (existsSync(entryPath)) {
      return importModuleFile(entryPath, name);
    }
  }

  // 3. Packaged module — resolved via package.json "main" or "exports" field.
  //    Covers compiled TypeScript modules and npm-installed packages.
  const pkgJsonPath = join(dir, "package.json");
  if (existsSync(pkgJsonPath)) {
    const entryPath = resolvePackageEntry(dir, pkgJsonPath);
    if (entryPath) {
      return importModuleFile(entryPath, name);
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

/** Import a single module file and adapt its export to KotaModule. */
async function importModuleFile(absPath: string, displayName: string): Promise<KotaModule> {
  const url = pathToFileURL(absPath).href;
  const imported = await import(url);
  return adaptExport(imported.default ?? imported, displayName);
}

async function reimportModuleFile(absPath: string, displayName: string): Promise<KotaModule> {
  const url = `${pathToFileURL(absPath).href}?v=${Date.now()}`;
  const imported = await import(url);
  return adaptExport(imported.default ?? imported, displayName);
}

/**
 * Re-import a single installed module from `.kota/modules/<name>/` with ESM
 * cache busting so changed source is picked up.
 */
export async function reimportInstalledModule(name: string, cwd?: string): Promise<KotaModule | null> {
  const base = cwd || process.cwd();
  const moduleDir = resolve(base, MODULES_DIR, name);
  if (!existsSync(moduleDir)) return null;

  const manifestPath = join(moduleDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw) as ModuleManifest;
      const errors = validateManifest(manifest);
      if (errors.length > 0) return null;
      return manifestToModule(manifest);
    } catch {
      return null;
    }
  }

  for (const entry of ["index.js", "index.mjs"]) {
    const entryPath = join(moduleDir, entry);
    if (existsSync(entryPath)) {
      return reimportModuleFile(entryPath, name);
    }
  }

  const pkgJsonPath = join(moduleDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    const entryPath = resolvePackageEntry(moduleDir, pkgJsonPath);
    if (entryPath) {
      return reimportModuleFile(entryPath, name);
    }
  }

  return null;
}
