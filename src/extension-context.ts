import type { ChannelDef } from "./channel.js";
import type { KotaConfig } from "./config.js";
import { registerDynamicStateProvider } from "./dynamic-state.js";
import type { EventBus } from "./event-bus.js";
import { getExtensionLogStore } from "./extension-log.js";
import { ExtensionStorage } from "./extension-storage.js";
import type { CreateSessionOptions, ExtensionContext, ExtensionEventProxy, ExtensionSession, ExtensionSummary, RouteRegistration } from "./extension-types.js";
import { getProviderRegistry } from "./extensions/providers/index.js";
import { resolveLogFormatter } from "./log-format.js";
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
  getContributedChannels: () => ChannelDef[];
  getExtensionSummaries: () => ExtensionSummary[];
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
    subscribe: (event: string, handler: (payload: Record<string, unknown>) => void): () => void => {
      const bus = getBus();
      if (!bus) return () => {};
      return bus.on(event, handler as never);
    },
  };
}

export function createExtensionContext(params: ExtensionContextParams, extensionName?: string): ExtensionContext {
  const { cwd, verbose, config, extensionStorages, getBus, getRoutes, getContributedWorkflows, getContributedChannels, getExtensionSummaries, sessionFactory, callTool } = params;
  const storage = extensionName
    ? getOrCreateStorage(extensionName, cwd, extensionStorages)
    : new ExtensionStorage(cwd, "_default");
  const prefix = extensionName ? `[extension:${extensionName}]` : "[extension]";
  const formatLine = resolveLogFormatter(config.log?.format);
  const log = {
    info: (msg: string, data?: unknown) => {
      console.error(formatLine("info", prefix, msg, data));
      getExtensionLogStore()?.append(extensionName ?? "_default", "info", msg, data);
    },
    warn: (msg: string, data?: unknown) => {
      console.error(formatLine("warn", prefix, msg, data));
      getExtensionLogStore()?.append(extensionName ?? "_default", "warn", msg, data);
    },
    error: (msg: string, data?: unknown) => {
      console.error(formatLine("error", prefix, msg, data));
      getExtensionLogStore()?.append(extensionName ?? "_default", "error", msg, data);
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) console.error(formatLine("debug", prefix, msg, data));
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
    getContributedChannels,
    getExtensionSummaries,
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
    registerDynamicStateProvider: (name, fn) => {
      registerDynamicStateProvider(name, fn);
    },
  };
}
