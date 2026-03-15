import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { KotaPlugin, PluginContext } from "./plugin-types.js";
import { registerTool, clearCustomTools } from "./tools/index.js";
import { registerCustomGroup, clearCustomGroups } from "./tool-groups.js";
import { adaptExport } from "./tool-adapters.js";

const PLUGIN_DIR = ".kota/plugins";

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

  /** Load all plugins from .kota/plugins/ relative to cwd. */
  async loadAll(cwd?: string): Promise<void> {
    const dir = resolve(cwd || process.cwd(), PLUGIN_DIR);
    if (!existsSync(dir)) return;

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
      .sort();

    for (const file of files) {
      try {
        await this.loadPlugin(join(dir, file), file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Plugin ${file} failed to load: ${msg}`);
      }
    }

    if (this.plugins.length > 0) {
      const toolCount = this.plugins.reduce((n, p) => n + (p.tools?.length ?? 0), 0);
      console.error(
        `[kota] Plugins: ${this.plugins.length} loaded, ${toolCount} tool(s) registered`,
      );
    }
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
        registerTool(def.tool, def.runner);
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

  /** Unload all plugins: call onUnload hooks, clear registered tools and groups. */
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
    }
    clearCustomTools();
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
