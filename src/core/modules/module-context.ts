import {
  type PostRunHook,
  type PreRunHook,
  registerHarnessHook as registerHarnessHookImpl,
} from "#core/agent-harness/hooks.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { getSecretStore } from "#core/config/secrets.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { ModuleEventDef } from "#core/events/module-event.js";
import { registerCleanupHook } from "#core/loop/cleanup-hooks.js";
import { registerDynamicStateProvider } from "#core/loop/dynamic-state.js";
import { registerPreSendHook as registerPreSendHookImpl } from "#core/loop/pre-send-hooks.js";
import { getActiveKotaClient } from "#core/server/client-holder.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { getRegisteredTools } from "#core/tools/index.js";
import { registerCustomGroup } from "#core/tools/tool-groups.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { resolveLogFormatter } from "#core/util/log-format.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { getModuleLogStore } from "./module-log.js";
import { ModuleStorage } from "./module-storage.js";
import type { ControlRouteRegistration, CreateSessionOptions, HealthCheckResult, ModuleEventProxy, ModuleRuntimeContext, ModuleSession, ModuleSummary, RouteRegistration } from "./module-types.js";
import { getProviderRegistry, initProviderRegistry } from "./provider-registry.js";
import type { ProviderToken } from "./provider-token.js";

export interface ModuleContextParams {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ModuleStorage>;
  getBus: () => EventBus | null;
  getRoutes: () => RouteRegistration[];
  getContributedControlRoutes: () => ControlRouteRegistration[];
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

function isModuleEventDef(value: unknown): value is ModuleEventDef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    Array.isArray((value as { fields?: unknown }).fields)
  );
}

function createEventProxy(
  getBus: () => EventBus | null,
): ModuleEventProxy {
  const proxy = {
    emit: (event: unknown, payload: Record<string, unknown>): void => {
      const bus = getBus();
      if (!bus) return;
      const name = isModuleEventDef(event) ? event.name : (event as string);
      bus.emit(name, payload);
    },
    subscribe: (event: unknown, handler: (payload: never) => void): () => void => {
      const bus = getBus();
      if (!bus) return () => {};
      const name = isModuleEventDef(event) ? event.name : (event as string);
      return bus.on(name, handler as never);
    },
    emitExternal: (event: string, payload: Record<string, unknown>): void => {
      getBus()?.emit(event, payload);
    },
    subscribeExternal: (
      event: string,
      handler: (payload: Record<string, unknown>) => void,
    ): () => void => {
      const bus = getBus();
      if (!bus) return () => {};
      return bus.on(event, handler as never);
    },
    listenerCount: (event?: string): number => {
      return getBus()?.listenerCount(event) ?? 0;
    },
  };
  return proxy as unknown as ModuleEventProxy;
}

export function createModuleContext(params: ModuleContextParams, moduleName?: string): ModuleRuntimeContext {
  const { cwd, verbose, config, moduleStorages, getBus, getRoutes, getContributedControlRoutes, getContributedWorkflows, getContributedChannels, getModuleSummaries, resolveAgentDef, resolveSkillsPrompt, sessionFactory, callTool, probeHealthChecks, getRegisteredConfigKeys } = params;
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
    getContributedControlRoutes,
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
    registerProvider: <T>(token: ProviderToken<T>, provider: T): void => {
      if (!moduleName) {
        log.warn(`Cannot register provider without a module name`);
        return;
      }
      const reg = getProviderRegistry() ?? initProviderRegistry();
      reg.register(token, moduleName, provider);
      log.info(`Registered as provider for "${token}"`);
    },
    getProvider: <T>(token: ProviderToken<T>): T | null => {
      const reg = getProviderRegistry();
      return reg?.get(token) ?? null;
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
    registerPreSendHook: (name, fn) => {
      registerPreSendHookImpl(moduleName ?? "_default", name, fn);
    },
    registerHarnessHook: (registration) => {
      const owner = moduleName ?? "_default";
      if (registration.kind === "preRun") {
        registerHarnessHookImpl({
          kind: "preRun",
          owner,
          name: registration.name,
          handler: registration.handler as PreRunHook,
        });
      } else {
        registerHarnessHookImpl({
          kind: "postRun",
          owner,
          name: registration.name,
          handler: registration.handler as PostRunHook,
        });
      }
    },
    resolveAgentDef,
    resolveSkillsPrompt,
    probeHealthChecks,
    getRegisteredConfigKeys,
    get client(): KotaClient {
      return getActiveKotaClient();
    },
  };
}
