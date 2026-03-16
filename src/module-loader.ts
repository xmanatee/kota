/**
 * ModuleLoader — discovers, orders, and manages KotaModule lifecycle.
 *
 * Handles:
 * - Dependency-aware loading (topological sort)
 * - Tool registration (via tools/index.ts registerTool)
 * - CLI command collection (returned to caller for Commander integration)
 * - HTTP route collection (returned to caller for server integration)
 * - Event bus connection and cleanup
 */

import type { Command } from "commander";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import type { KotaModule, ModuleContext, RouteRegistration } from "./module-types.js";
import { registerCustomGroup } from "./tool-groups.js";
import { clearCustomTools, registerTool } from "./tools/index.js";

export class ModuleLoader {
  private modules: KotaModule[] = [];
  private eventUnsubs: (() => void)[] = [];
  private verbose: boolean;
  private config: KotaConfig;

  constructor(config: KotaConfig, verbose = false) {
    this.config = config;
    this.verbose = verbose;
  }

  private createContext(): ModuleContext {
    return {
      cwd: process.cwd(),
      verbose: this.verbose,
      config: this.config,
      registerGroup: (name, toolNames, pattern) => {
        registerCustomGroup(name, toolNames, pattern);
      },
    };
  }

  /** Register and initialize a single module. */
  async load(mod: KotaModule): Promise<void> {
    if (this.modules.some((m) => m.name === mod.name)) {
      throw new Error(`Duplicate module name: "${mod.name}"`);
    }

    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        if (!this.modules.some((m) => m.name === dep)) {
          throw new Error(
            `Module "${mod.name}" requires "${dep}" which is not loaded`,
          );
        }
      }
    }

    if (mod.tools) {
      for (const def of mod.tools) {
        registerTool(def.tool, def.runner);
        if (def.group) {
          registerCustomGroup(def.group, [def.tool.name]);
        }
      }
    }

    const ctx = this.createContext();
    if (mod.onLoad) await mod.onLoad(ctx);

    this.modules.push(mod);
    if (this.verbose) {
      const tc = mod.tools?.length ?? 0;
      console.error(`[kota] Module "${mod.name}" loaded (${tc} tools)`);
    }
  }

  /** Load multiple modules, respecting dependency order. */
  async loadAll(modules: KotaModule[]): Promise<void> {
    const sorted = topoSort(modules);
    for (const mod of sorted) {
      try {
        await this.load(mod);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${mod.name}" failed to load: ${msg}`);
      }
    }

    if (this.modules.length > 0 && this.verbose) {
      const toolCount = this.modules.reduce(
        (n, m) => n + (m.tools?.length ?? 0),
        0,
      );
      console.error(
        `[kota] Modules: ${this.modules.length} loaded, ${toolCount} tool(s)`,
      );
    }
  }

  /** Collect CLI commands from all loaded modules. */
  getCommands(): Command[] {
    const ctx = this.createContext();
    const commands: Command[] = [];
    for (const mod of this.modules) {
      if (mod.commands) {
        try {
          commands.push(...mod.commands(ctx));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[kota] Module "${mod.name}" command registration failed: ${msg}`,
          );
        }
      }
    }
    return commands;
  }

  /** Collect HTTP routes from all loaded modules. */
  getRoutes(): RouteRegistration[] {
    const ctx = this.createContext();
    const routes: RouteRegistration[] = [];
    for (const mod of this.modules) {
      if (mod.routes) {
        try {
          routes.push(...mod.routes(ctx));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[kota] Module "${mod.name}" route registration failed: ${msg}`,
          );
        }
      }
    }
    return routes;
  }

  /** Subscribe all loaded modules to the event bus. */
  connectEvents(bus: EventBus): void {
    for (const mod of this.modules) {
      if (mod.events) {
        try {
          const unsubs = mod.events(bus);
          this.eventUnsubs.push(...unsubs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[kota] Module "${mod.name}" event subscription failed: ${msg}`,
          );
        }
      }
    }
  }

  /** Unload all modules in reverse order. */
  async unloadAll(): Promise<void> {
    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs = [];

    for (const mod of [...this.modules].reverse()) {
      if (mod.onUnload) {
        try {
          await mod.onUnload();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${mod.name}" unload error: ${msg}`);
        }
      }
    }

    clearCustomTools();
    this.modules = [];
  }

  getLoadedModules(): string[] {
    return this.modules.map((m) => m.name);
  }

  getModuleCount(): number {
    return this.modules.length;
  }

  getToolCount(): number {
    return this.modules.reduce((n, m) => n + (m.tools?.length ?? 0), 0);
  }
}

/** Topological sort by dependencies. Modules with unresolvable deps are appended at the end. */
function topoSort(modules: KotaModule[]): KotaModule[] {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const result: KotaModule[] = [];

  function visit(mod: KotaModule): void {
    if (visited.has(mod.name)) return;
    visited.add(mod.name);
    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        const depMod = byName.get(dep);
        if (depMod) visit(depMod);
      }
    }
    result.push(mod);
  }

  for (const mod of modules) visit(mod);
  return result;
}
