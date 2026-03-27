import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import { getExtensionLogStore } from "./extension-log.js";
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
  extensionStorages: Map<string, ExtensionStorage>;
  getBus: () => EventBus | null;
  getRoutes: () => RouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  sessionFactory: ((opts: CreateSessionOptions) => ExtensionSession) | null;
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
}

function getOrCreateStorage(
  extensionName: string,
  cwd: string,
  extensionStorages: Map<string, ExtensionStorage>,
): ExtensionStorage {
  let storage = extensionStorages.get(extensionName);
  if (!storage) {
    storage = new ExtensionStorage(cwd, extensionName);
    extensionStorages.set(extensionName, storage);
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

export function createExtensionContext(params: ExtensionContextParams, extensionName?: string): ExtensionContext {
  const { cwd, verbose, config, extensionStorages, getBus, getRoutes, getContributedWorkflows, sessionFactory, callTool } = params;
  const storage = extensionName
    ? getOrCreateStorage(extensionName, cwd, extensionStorages)
    : new ExtensionStorage(cwd, "_default");
  const prefix = extensionName ? `[extension:${extensionName}]` : "[extension]";
  const log = {
    info: (msg: string, data?: unknown) => {
      console.error(`${prefix} ${msg}`);
      getExtensionLogStore()?.append(extensionName ?? "_default", "info", msg, data);
    },
    warn: (msg: string, data?: unknown) => {
      console.error(`${prefix} WARN: ${msg}`);
      getExtensionLogStore()?.append(extensionName ?? "_default", "warn", msg, data);
    },
    error: (msg: string, data?: unknown) => {
      console.error(`${prefix} ERROR: ${msg}`);
      getExtensionLogStore()?.append(extensionName ?? "_default", "error", msg, data);
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) console.error(`${prefix} DEBUG: ${msg}`);
      getExtensionLogStore()?.append(extensionName ?? "_default", "debug", msg, data);
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
      if (!extensionName) return undefined;
      return config.extensions?.[extensionName] as T | undefined;
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
      if (!extensionName) {
        log.warn(`Cannot register provider without an extension name`);
        return;
      }
      reg.register(type, extensionName, provider);
      log.info(`Registered as provider for "${type}"`);
    },
    getProvider: <T>(type: string): T | null => {
      const reg = getProviderRegistry();
      return reg?.get<T>(type) ?? null;
    },
    callTool,
    registerMiddleware: (name, fn, priority) => {
      getToolMiddleware().add(name, fn, { priority, owner: extensionName });
    },
  };
}
