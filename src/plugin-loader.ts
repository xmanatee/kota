import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KotaPlugin, PluginContext } from "./plugin-types.js";
import { adaptExport } from "./tool-adapters.js";
import { clearCustomGroups, registerCustomGroup } from "./tool-groups.js";
import { deregisterModuleTools, registerTool } from "./tools/index.js";

const PLUGIN_DIR = ".kota/plugins";
const PACKAGES_DIR = ".kota/packages";

/**
 * Discovers and manages KOTA plugins from `.kota/plugins/`.
 * Plugins are JS/MJS files that default-export a KotaPlugin object.
 */
export class PluginManager {
  private plugins: KotaPlugin[] = [];
  private verbose: boolean;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /** Load all plugins from .kota/plugins/ and .kota/packages/ relative to cwd. */
  async loadAll(cwd?: string): Promise<void> {
    const base = cwd || process.cwd();

    // 1. Load file-based plugins from .kota/plugins/
    const pluginDir = resolve(base, PLUGIN_DIR);
    if (existsSync(pluginDir)) {
      const files = readdirSync(pluginDir)
        .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
        .sort();

      for (const file of files) {
        try {
          await this.loadPlugin(join(pluginDir, file), file);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Plugin ${file} failed to load: ${msg}`);
        }
      }
    }

    // 2. Load npm-installed packages from .kota/packages/
    await this.loadNpmPackages(base);

    if (this.plugins.length > 0) {
      const toolCount = this.plugins.reduce((n, p) => n + (p.tools?.length ?? 0), 0);
      console.error(
        `[kota] Plugins: ${this.plugins.length} loaded, ${toolCount} tool(s) registered`,
      );
    }
  }

  /** Load tools from npm packages installed in .kota/packages/node_modules/. */
  private async loadNpmPackages(cwd: string): Promise<void> {
    const pkgJsonPath = resolve(cwd, PACKAGES_DIR, "package.json");
    if (!existsSync(pkgJsonPath)) return;

    let deps: Record<string, string>;
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      deps = pkgJson.dependencies || {};
    } catch {
      return;
    }

    const nodeModules = resolve(cwd, PACKAGES_DIR, "node_modules");
    if (!existsSync(nodeModules)) return;

    for (const pkgName of Object.keys(deps).sort()) {
      try {
        await this.loadNpmPackage(nodeModules, pkgName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] npm package "${pkgName}" failed to load: ${msg}`);
      }
    }
  }

  /** Load a single npm package as a KOTA plugin. */
  private async loadNpmPackage(nodeModules: string, pkgName: string): Promise<void> {
    // Resolve the package's main entry
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

    await this.loadPlugin(entryPath, `npm:${pkgName}`);
  }

  /** Load a single plugin from a file path. */
  async loadPlugin(absPath: string, displayName: string): Promise<void> {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    const plugin = adaptExport(mod.default ?? mod, displayName);

    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`duplicate plugin name "${plugin.name}"`);
    }

    // Register tools before onLoad so the plugin can reference them
    if (plugin.tools) {
      for (const def of plugin.tools) {
        registerTool(def.tool, def.runner, `plugin:${plugin.name}`);
        if (def.group) {
          registerCustomGroup(def.group, [def.tool.name]);
        }
      }
    }

    const ctx: PluginContext = {
      cwd: process.cwd(),
      verbose: this.verbose,
      registerGroup: (name, toolNames, pattern) => {
        registerCustomGroup(name, toolNames, pattern);
      },
    };

    if (plugin.onLoad) await plugin.onLoad(ctx);

    this.plugins.push(plugin);
    if (this.verbose) {
      const tc = plugin.tools?.length ?? 0;
      console.error(`[kota] Plugin "${plugin.name}" loaded (${tc} tools)`);
    }
  }

  /** Unload all plugins: call onUnload hooks, deregister each plugin's tools. */
  async unloadAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onUnload) {
        try {
          await plugin.onUnload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Plugin "${plugin.name}" unload error: ${msg}`);
        }
      }
      deregisterModuleTools(`plugin:${plugin.name}`);
    }
    clearCustomGroups();
    this.plugins = [];
  }

  getLoadedPlugins(): string[] {
    return this.plugins.map((p) => p.name);
  }

  getPluginCount(): number {
    return this.plugins.length;
  }

  getToolCount(): number {
    return this.plugins.reduce((n, p) => n + (p.tools?.length ?? 0), 0);
  }
}
