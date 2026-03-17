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
import { ModuleStorage } from "./module-storage.js";
import type { CreateSessionOptions, KotaModule, ModuleContext, ModuleEventProxy, ModuleLogger, ModuleSession, RouteRegistration, ToolDef } from "./module-types.js";
import { getProviderRegistry } from "./providers.js";
import { getSecretStore } from "./secrets.js";
import { registerCustomGroup } from "./tool-groups.js";
import { deregisterModuleTools, getRegisteredTools, registerTool } from "./tools/index.js";

export type ModuleLoaderOptions = {
  /** Skip tool registration — only load modules for command/route discovery. */
  commandsOnly?: boolean;
};

export class ModuleLoader {
  private modules: KotaModule[] = [];
  private eventUnsubs: (() => void)[] = [];
  /** Per-module event unsubscribe functions for targeted cleanup. */
  private moduleEventUnsubs = new Map<string, (() => void)[]>();
  /** Per-module storage instances. */
  private moduleStorages = new Map<string, ModuleStorage>();
  /** Original module definitions for reload support. */
  private moduleRegistry = new Map<string, KotaModule>();
  /** Resolved tool counts per module (needed when tools is a function). */
  private moduleToolCounts = new Map<string, number>();
  /** Collected prompt sections from loaded modules. */
  private promptSections = new Map<string, string>();
  /** Event bus reference for reconnecting events after reload. */
  private bus: EventBus | null = null;
  private verbose: boolean;
  private config: KotaConfig;
  private cwd: string;
  private commandsOnly: boolean;
  /** Reentrancy guard for getRoutes() — prevents infinite recursion when
   *  a module's routes() callback calls ctx.getRoutes(). */
  private collectingRoutes = false;
  /** Injected session factory — set by AgentSession to avoid circular imports. */
  private sessionFactory: ((opts: CreateSessionOptions) => ModuleSession) | null = null;

  constructor(config: KotaConfig, verbose = false, options?: ModuleLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.cwd = process.cwd();
    this.commandsOnly = options?.commandsOnly ?? false;
  }

  /** Inject a session factory. Called by AgentSession to avoid circular imports. */
  setSessionFactory(factory: (opts: CreateSessionOptions) => ModuleSession): void {
    this.sessionFactory = factory;
  }

  /** Create a module-specific context with scoped storage and config access. */
  private createContext(moduleName?: string): ModuleContext {
    const storage = moduleName
      ? this.getOrCreateStorage(moduleName)
      : new ModuleStorage(this.cwd, "_default");
    const modName = moduleName;
    const prefix = modName ? `[module:${modName}]` : "[module]";
    const log: ModuleLogger = {
      info: (msg: string) => console.error(`${prefix} ${msg}`),
      warn: (msg: string) => console.error(`${prefix} WARN: ${msg}`),
      error: (msg: string) => console.error(`${prefix} ERROR: ${msg}`),
      debug: (msg: string) => {
        if (this.verbose) console.error(`${prefix} DEBUG: ${msg}`);
      },
    };
    return {
      cwd: this.cwd,
      verbose: this.verbose,
      config: this.config,
      storage,
      registerGroup: (name, toolNames, pattern) => {
        registerCustomGroup(name, toolNames, pattern);
      },
      getRoutes: () => this.getRoutes(),
      getModuleConfig: <T = Record<string, unknown>>(): T | undefined => {
        if (!modName) return undefined;
        return this.config.modules?.[modName] as T | undefined;
      },
      log,
      getSecret: (key: string): string | null => {
        const store = getSecretStore();
        return store?.get(key) ?? null;
      },
      listTools: (): string[] => {
        return getRegisteredTools().map((t) => t.name);
      },
      events: this.createEventProxy(modName),
      createSession: (opts?: CreateSessionOptions): ModuleSession => {
        if (!this.sessionFactory) {
          throw new Error("Session factory not available. createSession() can only be used during agent sessions, not CLI commands.");
        }
        return this.sessionFactory(opts ?? {});
      },
      registerProvider: (type: string, provider: unknown): void => {
        const reg = getProviderRegistry();
        if (!reg) {
          log.warn(`Cannot register provider for "${type}" — registry not initialized`);
          return;
        }
        if (!modName) {
          log.warn(`Cannot register provider without a module name`);
          return;
        }
        reg.register(type, modName, provider);
        log.info(`Registered as provider for "${type}"`);
      },
      getProvider: <T>(type: string): T | null => {
        const reg = getProviderRegistry();
        return reg?.get<T>(type) ?? null;
      },
    };
  }

  /** Get or create the scoped storage for a module. */
  private getOrCreateStorage(moduleName: string): ModuleStorage {
    let storage = this.moduleStorages.get(moduleName);
    if (!storage) {
      storage = new ModuleStorage(this.cwd, moduleName);
      this.moduleStorages.set(moduleName, storage);
    }
    return storage;
  }

  /** Create a scoped event proxy for a module. Lazy — resolves this.bus at call time. */
  private createEventProxy(moduleName?: string): ModuleEventProxy {
    const trackUnsub = (unsub: () => void) => {
      if (!moduleName) return;
      const existing = this.moduleEventUnsubs.get(moduleName) ?? [];
      existing.push(unsub);
      this.moduleEventUnsubs.set(moduleName, existing);
    };

    return {
      emit: (event: string, payload: Record<string, unknown>) => {
        this.bus?.emit(event, payload);
      },
      on: (event: string, handler: (payload: Record<string, unknown>) => void) => {
        if (!this.bus) return () => {};
        const unsub = this.bus.on(event, handler);
        trackUnsub(unsub);
        return unsub;
      },
      once: (event: string, handler: (payload: Record<string, unknown>) => void) => {
        if (!this.bus) return () => {};
        const unsub = this.bus.once(event, handler);
        trackUnsub(unsub);
        return unsub;
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

    const ctx = this.createContext(mod.name);

    // Resolve tools — static array or factory function
    const tools: ToolDef[] | undefined = mod.tools
      ? typeof mod.tools === "function" ? mod.tools(ctx) : mod.tools
      : undefined;

    if (tools && !this.commandsOnly) {
      for (const def of tools) {
        registerTool(def.tool, def.runner, mod.name);
        if (def.group) {
          registerCustomGroup(def.group, [def.tool.name]);
        }
      }
      this.moduleToolCounts.set(mod.name, tools.length);
    }

    if (mod.onLoad && !this.commandsOnly) await mod.onLoad(ctx);

    // Collect prompt section if provided
    if (mod.promptSection && !this.commandsOnly) {
      try {
        const section = mod.promptSection(ctx);
        if (section) {
          this.promptSections.set(mod.name, section);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${mod.name}" promptSection failed: ${msg}`);
      }
    }

    this.modules.push(mod);
    this.moduleRegistry.set(mod.name, mod);
    if (this.verbose) {
      const tc = this.moduleToolCounts.get(mod.name) ?? 0;
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

    // Activate configured providers after all modules have loaded
    this.activateConfiguredProviders();

    if (this.modules.length > 0 && this.verbose) {
      console.error(
        `[kota] Modules: ${this.modules.length} loaded, ${this.getToolCount()} tool(s)`,
      );
    }
  }

  /** Collect CLI commands from all loaded modules. */
  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const mod of this.modules) {
      if (mod.commands) {
        try {
          commands.push(...mod.commands(this.createContext(mod.name)));
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
    // Reentrancy guard: if a module's routes() calls ctx.getRoutes(),
    // return what we've collected so far instead of recursing infinitely.
    if (this.collectingRoutes) return [];
    this.collectingRoutes = true;
    try {
      const routes: RouteRegistration[] = [];
      for (const mod of this.modules) {
        if (mod.routes) {
          try {
            routes.push(...mod.routes(this.createContext(mod.name)));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[kota] Module "${mod.name}" route registration failed: ${msg}`,
            );
          }
        }
      }
      return routes;
    } finally {
      this.collectingRoutes = false;
    }
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

  /** Get all prompt sections contributed by loaded modules, joined with headings. */
  getPromptSections(): string {
    if (this.promptSections.size === 0) return "";
    const parts: string[] = [];
    for (const [name, section] of this.promptSections) {
      parts.push(`\n### ${name}\n${section}`);
    }
    return `\n\n## Module Capabilities\n${parts.join("\n")}`;
  }

  /** Get the storage instance for a specific module. */
  getModuleStorage(moduleName: string): ModuleStorage | undefined {
    return this.moduleStorages.get(moduleName);
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

    // Remove prompt section, storage, and tool count references
    this.promptSections.delete(moduleName);
    this.moduleStorages.delete(moduleName);
    this.moduleToolCounts.delete(moduleName);

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
    this.moduleStorages.clear();
    this.moduleToolCounts.clear();
    this.promptSections.clear();
    this.bus = null;

    // Clear provider registry
    const reg = getProviderRegistry();
    if (reg) reg.clear();
  }

  /** Activate providers specified in config.providers after all modules are loaded. */
  private activateConfiguredProviders(): void {
    const providers = this.config.providers;
    if (!providers) return;
    const reg = getProviderRegistry();
    if (!reg) return;

    for (const [type, name] of Object.entries(providers)) {
      if (!reg.setActive(type, name)) {
        console.error(
          `[kota] Provider "${name}" for "${type}" not found. Available: ${reg.list(type).join(", ") || "(none)"}`,
        );
      } else if (this.verbose) {
        console.error(`[kota] Provider for "${type}" set to "${name}"`);
      }
    }
  }

  getLoadedModules(): string[] {
    return this.modules.map((m) => m.name);
  }

  getModuleCount(): number {
    return this.modules.length;
  }

  getToolCount(): number {
    if (this.commandsOnly) return 0;
    let total = 0;
    for (const count of this.moduleToolCounts.values()) total += count;
    return total;
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
