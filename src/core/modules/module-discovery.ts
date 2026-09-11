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
import {
  type LoadConfigOptions,
  loadScopeConfigTrustDecision,
} from "#core/config/config.js";
import { loadManifest, manifestToModule } from "#core/manifest/index.js";
import { migrateSavedTools } from "#core/manifest/migrate-saved-tools.js";
import { isManifestModuleName } from "#core/manifest/validation.js";
import { adaptExport } from "#core/tools/tool-adapters.js";
import { assertModuleDefinition } from "./module-definition.js";
import type { KotaModule } from "./module-types.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

const MODULES_DIR = ".kota/modules";

/**
 * Discover all user modules from `.kota/modules/`.
 * Returns KotaModule[] ready for ModuleLoader.loadAll().
 */
export async function discoverModules(
  cwd?: string,
  verbose = false,
  configOptions: LoadConfigOptions = {},
): Promise<KotaModule[]> {
  const base = cwd || process.cwd();
  const modulesDir = resolve(base, MODULES_DIR);

  if (!existsSync(modulesDir) && !existsSync(join(base, ".kota", "tools"))) return [];
  const trust = loadScopeConfigTrustDecision(base, configOptions);
  if (!trust.trusted) {
    if (verbose) {
      printTerminalDiagnostic(
        `[kota] Ignored bundled modules in ${modulesDir}: scope is not trusted by machine authority`,
        "warn",
      );
    }
    return [];
  }

  migrateSavedTools(base);
  if (!existsSync(modulesDir)) return [];

  const entries = readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const modules: KotaModule[] = [];

  for (const name of entries) {
    const moduleDir = join(modulesDir, name);
    try {
      const module = await loadModuleDirectory(moduleDir, name, base);
      if (module) {
        assertModuleDefinition(module);
        modules.push(module);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`[kota] Module "${name}" failed to load: ${msg}`, "error");
    }
  }

  if (modules.length > 0 && verbose) {
    const toolCount = modules.reduce((n, module) => n + (module.tools?.length ?? 0), 0);
    printTerminalDiagnostic(`[kota] Discovered ${modules.length} module(s) with ${toolCount} tool(s)`);
  }

  return modules;
}

/**
 * Load a single module from its directory.
 * Checks for manifest.json, index.js/mjs, then package.json (in that order).
 * Returns null for empty or unrecognized directories.
 */
async function loadModuleDirectory(dir: string, name: string, scopeRoot: string): Promise<KotaModule | null> {
  // 1. Manifest-based module (JSON-defined tools)
  const manifestPath = join(dir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = loadManifest(name, scopeRoot);
    return manifest ? manifestToModule(manifest) : null;
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
export async function reimportInstalledModule(
  name: string,
  cwd?: string,
  configOptions: LoadConfigOptions = {},
): Promise<KotaModule | null> {
  const base = cwd || process.cwd();
  if (!isManifestModuleName(name)) throw new Error(`Invalid module name: ${name}`);
  const moduleDir = resolve(base, MODULES_DIR, name);
  if (!existsSync(moduleDir)) return null;
  if (!loadScopeConfigTrustDecision(base, configOptions).trusted) return null;

  const manifestPath = join(moduleDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = loadManifest(name, base);
    return manifest ? manifestToModule(manifest) : null;
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
