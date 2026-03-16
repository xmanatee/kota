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
import { deregisterModuleTools, registerTool } from "./tools/index.js";

export type ModuleLoaderOptions = {
  /** Skip tool registration — only load modules for command/route discovery. */
  commandsOnly?: boolean;
};

export class ModuleLoader {
  private modules: KotaModule[] = [];
  private eventUnsubs: (() => void)[] = [];
  /** Per-module event unsubscribe functions for targeted cleanup. */
  private moduleEventUnsubs = new Map<string, (() => void)[]>();
  /** Original module definitions for reload support. */
  private moduleRegistry = new Map<string, KotaModule>();
  /** Event bus reference for reconnecting events after reload. */
  private bus: EventBus | null = null;
  private verbose: boolean;
  private config: KotaConfig;
  private commandsOnly: boolean;

  constructor(config: KotaConfig, verbose = false, options?: ModuleLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.commandsOnly = options?.commandsOnly ?? false;
  }

  private createContext(): ModuleContext {
    return {
      cwd: process.cwd(),
      verbose: this.verbose,
      config: this.config,
      registerGroup: (name, toolNames, pattern) => {
        registerCustomGroup(name, toolNames, pattern);
      },
      getRoutes: () => this.getRoutes(),
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

    if (mod.tools && !this.commandsOnly) {
      for (const def of mod.tools) {
        registerTool(def.tool, def.runner, mod.name);
        if (def.group) {
          registerCustomGroup(def.group, [def.tool.name]);
        }
      }
    }

    const ctx = this.createContext();
    if (mod.onLoad && !this.commandsOnly) await mod.onLoad(ctx);

    this.modules.push(mod);
    this.moduleRegistry.set(mod.name, mod);
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
    this.bus = bus;
    for (const mod of this.modules) {
      this.connectModuleEvents(mod, bus);
    }
  }

  /** Subscribe a single module to the event bus. */
  private connectModuleEvents(mod: KotaModule, bus: EventBus): void {
    if (mod.events) {
      try {
        const unsubs = mod.events(bus);
        this.eventUnsubs.push(...unsubs);
        this.moduleEventUnsubs.set(mod.name, unsubs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[kota] Module "${mod.name}" event subscription failed: ${msg}`,
        );
      }
    }
  }

  /** Unload a single module by name. Returns true if found and unloaded. */
  async unload(moduleName: string): Promise<boolean> {
    const idx = this.modules.findIndex((m) => m.name === moduleName);
    if (idx < 0) return false;

    // Check for dependents — modules that depend on this one
    const dependents = this.getDependents(moduleName);
    if (dependents.length > 0) {
      throw new Error(
        `Cannot unload "${moduleName}": depended on by ${dependents.map((d) => `"${d}"`).join(", ")}`,
      );
    }

    const mod = this.modules[idx];

    // Disconnect this module's event subscriptions
    const unsubs = this.moduleEventUnsubs.get(moduleName);
    if (unsubs) {
      for (const unsub of unsubs) unsub();
      // Remove from the flat list too
      this.eventUnsubs = this.eventUnsubs.filter((u) => !unsubs.includes(u));
      this.moduleEventUnsubs.delete(moduleName);
    }

    // Call onUnload
    if (mod.onUnload) {
      try {
        await mod.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${moduleName}" unload error: ${msg}`);
      }
    }

    // Deregister this module's tools
    deregisterModuleTools(moduleName);

    // Remove from loaded list
    this.modules.splice(idx, 1);

    if (this.verbose) {
      console.error(`[kota] Module "${moduleName}" unloaded`);
    }
    return true;
  }

  /** Reload a module — unload then load again from its original definition. */
  async reload(moduleName: string): Promise<boolean> {
    const mod = this.moduleRegistry.get(moduleName);
    if (!mod) return false;

    const wasLoaded = this.modules.some((m) => m.name === moduleName);
    if (wasLoaded) {
      await this.unload(moduleName);
    }

    // Re-load from the stored definition
    await this.load(mod);

    // Re-connect events if bus is available
    if (this.bus) {
      this.connectModuleEvents(mod, this.bus);
    }

    if (this.verbose) {
      console.error(`[kota] Module "${moduleName}" reloaded`);
    }
    return true;
  }

  /** Find modules that depend on the given module. */
  getDependents(moduleName: string): string[] {
    return this.modules
      .filter((m) => m.dependencies?.includes(moduleName))
      .map((m) => m.name);
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

    for (const mod of [...this.modules]) {
      deregisterModuleTools(mod.name);
    }
    this.modules = [];
    this.moduleEventUnsubs.clear();
    this.moduleRegistry.clear();
    this.bus = null;
  }

  getLoadedModules(): string[] {
    return this.modules.map((m) => m.name);
  }

  getModuleCount(): number {
    return this.modules.length;
  }

  getToolCount(): number {
    if (this.commandsOnly) return 0;
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
