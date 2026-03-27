import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import { getModuleLogStore } from "./extension-log.js";
import { ExtensionStorage } from "./extension-storage.js";
import type { CreateSessionOptions, ExtensionContext, ExtensionEventProxy, ExtensionSession, RouteRegistration } from "./extension-types.js";
import { getProviderRegistry } from "./providers.js";
import { getSecretStore } from "./secrets.js";
import { registerCustomGroup } from "./tool-groups.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { getRegisteredTools } from "./tools/index.js";
import type { ToolResult } from "./tools/tool-result.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";

export interface ExtensionContextParams {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ExtensionStorage>;
  getBus: () => EventBus | null;
  getRoutes: () => RouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  sessionFactory: ((opts: CreateSessionOptions) => ExtensionSession) | null;
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

function getOrCreateStorage(
  moduleName: string,
  cwd: string,
  moduleStorages: Map<string, ExtensionStorage>,
): ExtensionStorage {
  let storage = moduleStorages.get(moduleName);
  if (!storage) {
    storage = new ExtensionStorage(cwd, moduleName);
    moduleStorages.set(moduleName, storage);
  }
  return storage;
}

function createEventProxy(
  getBus: () => EventBus | null,
): ExtensionEventProxy {
  return {
    emit: (event: string, payload: Record<string, unknown>) => {
      getBus()?.emit(event, payload);
    },
  };
}

export function createExtensionContext(params: ExtensionContextParams, moduleName?: string): ExtensionContext {
  const { cwd, verbose, config, moduleStorages, getBus, getRoutes, getContributedWorkflows, sessionFactory, callTool } = params;
  const storage = moduleName
    ? getOrCreateStorage(moduleName, cwd, moduleStorages)
    : new ExtensionStorage(cwd, "_default");
  const prefix = moduleName ? `[module:${moduleName}]` : "[module]";
  const log = {
    info: (msg: string, data?: unknown) => {
      console.error(`${prefix} ${msg}`);
      getModuleLogStore()?.append(moduleName ?? "_default", "info", msg, data);
    },
    warn: (msg: string, data?: unknown) => {
      console.error(`${prefix} WARN: ${msg}`);
      getModuleLogStore()?.append(moduleName ?? "_default", "warn", msg, data);
    },
    error: (msg: string, data?: unknown) => {
      console.error(`${prefix} ERROR: ${msg}`);
      getModuleLogStore()?.append(moduleName ?? "_default", "error", msg, data);
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) console.error(`${prefix} DEBUG: ${msg}`);
      getModuleLogStore()?.append(moduleName ?? "_default", "debug", msg, data);
    },
  };
  return {
    cwd,
    verbose,
    config,
    storage,
    registerGroup: (name, toolNames, pattern) => {
      registerCustomGroup(name, toolNames, pattern);
    },
    getRoutes,
    getContributedWorkflows,
    getExtensionConfig: <T = Record<string, unknown>>(): T | undefined => {
      if (!moduleName) return undefined;
      return config.modules?.[moduleName] as T | undefined;
    },
    log,
    getSecret: (key: string): string | null => {
      const store = getSecretStore();
      return store?.get(key) ?? null;
    },
    listTools: (): string[] => {
      return getRegisteredTools().map((t) => t.name);
    },
    events: createEventProxy(getBus),
    createSession: (opts?: CreateSessionOptions): ExtensionSession => {
      if (!sessionFactory) {
        throw new Error("Session factory not available. createSession() can only be used during agent sessions, not CLI commands.");
      }
      return sessionFactory(opts ?? {});
    },
    registerProvider: (type: string, provider: unknown): void => {
      const reg = getProviderRegistry();
      if (!reg) {
        log.warn(`Cannot register provider for "${type}" — registry not initialized`);
        return;
      }
      if (!moduleName) {
        log.warn(`Cannot register provider without a module name`);
        return;
      }
      reg.register(type, moduleName, provider);
      log.info(`Registered as provider for "${type}"`);
    },
    getProvider: <T>(type: string): T | null => {
      const reg = getProviderRegistry();
      return reg?.get<T>(type) ?? null;
    },
    callTool,
    registerMiddleware: (name, fn, priority) => {
      getToolMiddleware().add(name, fn, { priority, owner: moduleName });
    },
  };
}
