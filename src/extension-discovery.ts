/**
 * Extension discovery — finds user-authored plugins in `.kota/plugins/` and
 * `.kota/packages/`, adapts their exports to KotaExtension format, and returns
 * them for loading through ExtensionLoader.
 *
 * After the plugin→extension unification, plugins are simply extensions
 * discovered from disk. ExtensionLoader handles all lifecycle (load, unload,
 * reload, dependencies, tool registration).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KotaExtension } from "./extension-types.js";
import { discoverManifestExtensions } from "./manifest/index.js";
import { adaptExport } from "./tool-adapters.js";

const PLUGIN_DIR = ".kota/plugins";
const PACKAGES_DIR = ".kota/packages";

/**
 * Discover plugin extensions from `.kota/plugins/` and `.kota/packages/`.
 * Returns KotaExtension[] ready for ExtensionLoader.loadAll().
 */
export async function discoverExtensions(cwd?: string, verbose = false): Promise<KotaExtension[]> {
  const base = cwd || process.cwd();
  const extensions: KotaExtension[] = [];

  // 1. File-based plugins from .kota/plugins/
  const pluginDir = resolve(base, PLUGIN_DIR);
  if (existsSync(pluginDir)) {
    const files = readdirSync(pluginDir)
      .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
      .sort();

    for (const file of files) {
      try {
        const ext = await importPlugin(join(pluginDir, file), file);
        extensions.push(ext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Plugin ${file} failed to load: ${msg}`);
      }
    }
  }

  // 2. npm-installed packages from .kota/packages/
  const npmExtensions = await discoverNpmPackages(base);
  extensions.push(...npmExtensions);

  // 3. Manifest-based extensions from .kota/extensions/*/manifest.json
  const manifestExtensions = discoverManifestExtensions(base);
  extensions.push(...manifestExtensions);

  if (extensions.length > 0 && verbose) {
    const toolCount = extensions.reduce((n, ext) => n + (ext.tools?.length ?? 0), 0);
    console.error(`[kota] Discovered ${extensions.length} extension(s) with ${toolCount} tool(s)`);
  }

  return extensions;
}

/** Import a single plugin file and adapt its export to KotaExtension. */
async function importPlugin(absPath: string, displayName: string): Promise<KotaExtension> {
  const url = pathToFileURL(absPath).href;
  const imported = await import(url);
  return adaptExport(imported.default ?? imported, displayName);
}

/** Discover npm packages from .kota/packages/node_modules/. */
async function discoverNpmPackages(cwd: string): Promise<KotaExtension[]> {
  const pkgJsonPath = resolve(cwd, PACKAGES_DIR, "package.json");
  if (!existsSync(pkgJsonPath)) return [];

  let deps: Record<string, string>;
  try {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    deps = pkgJson.dependencies || {};
  } catch {
    return [];
  }

  const nodeModules = resolve(cwd, PACKAGES_DIR, "node_modules");
  if (!existsSync(nodeModules)) return [];

  const extensions: KotaExtension[] = [];
  for (const pkgName of Object.keys(deps).sort()) {
    try {
      const ext = await importNpmPackage(nodeModules, pkgName);
      extensions.push(ext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] npm package "${pkgName}" failed to load: ${msg}`);
    }
  }
  return extensions;
}

/** Import a single npm package and adapt its export to KotaExtension. */
async function importNpmPackage(nodeModules: string, pkgName: string): Promise<KotaExtension> {
  const pkgDir = join(nodeModules, ...pkgName.split("/"));
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(`package.json not found in ${pkgDir}`);
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  const main = pkgJson.exports?.["."] ?? pkgJson.main ?? "index.js";
  const mainPath = typeof main === "string" ? main : (main?.default ?? main?.import ?? "index.js");
  const entryPath = join(pkgDir, mainPath);

  if (!existsSync(entryPath)) {
    throw new Error(`entry point "${mainPath}" not found`);
  }

  return importPlugin(entryPath, `npm:${pkgName}`);
}
