import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { getSecretStore } from "#core/config/secrets.js";
import type { EventBus } from "#core/events/event-bus.js";
import { registerCleanupHook } from "#core/loop/cleanup-hooks.js";
import { registerDynamicStateProvider } from "#core/loop/dynamic-state.js";
import { getRegisteredTools } from "#core/tools/index.js";
import { registerCustomGroup } from "#core/tools/tool-groups.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { resolveLogFormatter } from "#core/util/log-format.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { getModuleLogStore } from "./module-log.js";
import { ModuleStorage } from "./module-storage.js";
import type { CreateSessionOptions, HealthCheckResult, ModuleContext, ModuleEventProxy, ModuleSession, ModuleSummary, RouteRegistration } from "./module-types.js";
import { getProviderRegistry } from "./provider-registry.js";

export interface ModuleContextParams {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ModuleStorage>;
  getBus: () => EventBus | null;
  getRoutes: () => RouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  getContributedChannels: () => ChannelDef[];
  getModuleSummaries: () => ModuleSummary[];
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  sessionFactory: ((opts: CreateSessionOptions) => ModuleSession) | null;
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
  getRegisteredConfigKeys: () => ReadonlySet<string>;
}

function getOrCreateStorage(
  moduleName: string,
  cwd: string,
  moduleStorages: Map<string, ModuleStorage>,
): ModuleStorage {
  let storage = moduleStorages.get(moduleName);
  if (!storage) {
    storage = new ModuleStorage(cwd, moduleName);
    moduleStorages.set(moduleName, storage);
  }
  return storage;
}

function createEventProxy(
  getBus: () => EventBus | null,
): ModuleEventProxy {
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

export function createModuleContext(params: ModuleContextParams, moduleName?: string): ModuleContext {
  const { cwd, verbose, config, moduleStorages, getBus, getRoutes, getContributedWorkflows, getContributedChannels, getModuleSummaries, resolveAgentDef, resolveSkillsPrompt, sessionFactory, callTool, probeHealthChecks, getRegisteredConfigKeys } = params;
  const storage = moduleName
    ? getOrCreateStorage(moduleName, cwd, moduleStorages)
    : new ModuleStorage(cwd, "_default");
  const prefix = moduleName ? `[module:${moduleName}]` : "[module]";
  const formatLine = resolveLogFormatter(config.log?.format);
  const log = {
    info: (msg: string, data?: unknown) => {
      console.error(formatLine("info", prefix, msg, data));
      getModuleLogStore()?.append(moduleName ?? "_default", "info", msg, data);
    },
    warn: (msg: string, data?: unknown) => {
      console.error(formatLine("warn", prefix, msg, data));
      getModuleLogStore()?.append(moduleName ?? "_default", "warn", msg, data);
    },
    error: (msg: string, data?: unknown) => {
      console.error(formatLine("error", prefix, msg, data));
      getModuleLogStore()?.append(moduleName ?? "_default", "error", msg, data);
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) console.error(formatLine("debug", prefix, msg, data));
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
    getContributedChannels,
    getModuleSummaries,
    getModuleConfig: <T = Record<string, unknown>>(): T | undefined => {
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
    createSession: (opts?: CreateSessionOptions): ModuleSession => {
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
    registerDynamicStateProvider: (name, fn) => {
      registerDynamicStateProvider(name, fn);
    },
    registerCleanupHook: (fn) => {
      registerCleanupHook(moduleName ?? "_default", fn);
    },
    resolveAgentDef,
    resolveSkillsPrompt,
    probeHealthChecks,
    getRegisteredConfigKeys,
  };
}
