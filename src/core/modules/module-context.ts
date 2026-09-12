import {
  type PostRunHook,
  type PreRunHook,
  registerHarnessHook as registerHarnessHookImpl,
} from "#core/agent-harness/hooks.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { getScopeSecretStore } from "#core/config/secrets.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { BusEnvelope, BusEvents } from "#core/events/event-bus-types.js";
import {
  assertModuleEventPayload,
  type ModuleEventDef,
  type ModuleEventPayload,
  type ModuleEventPayloadObject,
} from "#core/events/module-event.js";
import { registerCleanupHook } from "#core/loop/cleanup-hooks.js";
import { registerDynamicStateProvider } from "#core/loop/dynamic-state.js";
import { registerPreSendHook as registerPreSendHookImpl } from "#core/loop/pre-send-hooks.js";
import { getActiveKotaClient } from "#core/server/client-holder.js";
import { getRegisteredTools } from "#core/tools/index.js";
import { registerCustomGroup } from "#core/tools/tool-groups.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { getCurrentToolCallExecutionOptions } from "#core/tools/tool-runner-runtime.js";
import { resolveLogFormatter } from "#core/util/log-format.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import type { LogLevel } from "./module-log.js";
import { resolveModuleLogStore } from "./module-log-scope.js";
import { classifyModuleOperationFailure, type ModuleOperationFailureIdentity } from "./module-operation-health.js";
import { ModuleStorage } from "./module-storage.js";
import type { ControlRouteRegistration, CreateSessionOptions, HealthCheckResult, ModuleEventProxy, ModuleRuntimeContext, ModuleSession, ModuleSummary, RouteRegistration } from "./module-types.js";
import type { RegisteredUiSurfaceSource } from "./module-ui-surfaces.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { ProviderToken } from "./provider-token.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

export interface ModuleContextParams {
  cwd: string;
  scopeRoot?: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ModuleStorage>;
  getBus: () => EventBus | null;
  trackEventSubscription: (unsubscribe: () => void) => () => void;
  assertRegistrationOpen: () => void;
  trackRegistration: (dispose: () => void) => void;
  getRoutes: () => RouteRegistration[];
  getContributedControlRoutes: () => ControlRouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  getContributedChannels: () => ChannelDef[];
  getContributedUiSurfaces: () => RegisteredUiSurfaceSource[];
  getModuleSummaries: () => ModuleSummary[];
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  getSessionFactory: () => ((opts: CreateSessionOptions) => ModuleSession) | null;
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
  getRegisteredConfigKeys: () => ReadonlySet<string>;
  providerRegistry: ProviderRegistry;
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

/**
 * Typed implementation of `ModuleEventProxy`. Mirrors `EventBus`'s overloaded
 * shape so the value structurally satisfies the public interface without
 * round-tripping through `unknown`. Each public method declares the same
 * overloads `ModuleEventProxy` does, with a single combined implementation
 * signature that mirrors `EventBus`.
 */
class ModuleEventProxyImpl implements ModuleEventProxy {
  constructor(
    private readonly getBus: () => EventBus | null,
    private readonly assertRegistrationOpen: () => void,
    private readonly trackSubscription: (unsubscribe: () => void) => () => void,
  ) {}

  private requireBus(operation: string): EventBus {
    const bus = this.getBus();
    if (bus) return bus;
    throw new Error(
      `Module event ${operation} requires a bound runtime EventBus. ` +
        "Runtime module loading must bind the host event authority before lifecycle execution.",
    );
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  emit<E extends ModuleEventDef>(event: E, payload: ModuleEventPayload<E>): void;
  emit(event: string | ModuleEventDef, payload: Record<string, unknown>): void {
    const bus = this.requireBus("emit");
    if (typeof event !== "string") {
      assertModuleEventPayload(event, payload as ModuleEventPayloadObject);
      bus.emit(event, payload as ModuleEventPayload<typeof event>);
      return;
    }
    bus.emit(event, payload);
  }

  subscribe<K extends keyof BusEvents>(
    event: K,
    handler: (payload: BusEvents[K]) => void,
  ): () => void;
  subscribe<E extends ModuleEventDef>(
    event: E,
    handler: (payload: ModuleEventPayload<E>) => void,
  ): () => void;
  subscribe(event: "*", handler: (envelope: BusEnvelope) => void): () => void;
  subscribe(
    event: string | ModuleEventDef,
    handler: (payload: never) => void,
  ): () => void {
    this.assertRegistrationOpen();
    const bus = this.requireBus("subscribe");
    const name = typeof event === "string" ? event : event.name;
    return this.trackSubscription(bus.on(name, handler as never));
  }

  emitExternal(event: string, payload: Record<string, unknown>): void {
    this.requireBus("emitExternal").emit(event, payload);
  }

  subscribeExternal(
    event: string,
    handler: (payload: Record<string, unknown>) => void,
  ): () => void {
    this.assertRegistrationOpen();
    const bus = this.requireBus("subscribeExternal");
    return this.trackSubscription(bus.on(event, handler as never));
  }

  listenerCount(event?: string): number {
    return this.requireBus("listenerCount").listenerCount(event);
  }
}

function createEventProxy(
  getBus: () => EventBus | null,
  assertRegistrationOpen: () => void,
  trackSubscription: (unsubscribe: () => void) => () => void,
): ModuleEventProxy {
  return new ModuleEventProxyImpl(getBus, assertRegistrationOpen, trackSubscription);
}

export function createModuleContext(params: ModuleContextParams, moduleName?: string): ModuleRuntimeContext {
  const { cwd, verbose, config, moduleStorages, getBus, trackEventSubscription, assertRegistrationOpen, trackRegistration, getRoutes, getContributedControlRoutes, getContributedWorkflows, getContributedChannels, getContributedUiSurfaces, getModuleSummaries, resolveAgentDef, resolveSkillsPrompt, getSessionFactory, callTool, probeHealthChecks, getRegisteredConfigKeys, providerRegistry } = params;
  const storage = moduleName
    ? getOrCreateStorage(moduleName, cwd, moduleStorages)
    : new ModuleStorage(cwd, "_default");
  const prefix = moduleName ? `[module:${moduleName}]` : "[module]";
  const secretStore = getScopeSecretStore(cwd);
  const formatLine = resolveLogFormatter(config.log?.format);
  // Carry identities into recovery even when the issue reviewer is paused.
  // The durable events remain the observation authority; this is activation-local.
  const pendingOperationFailures = new Map<string, Map<string, ModuleOperationFailureIdentity>>();
  const appendLog = (level: LogLevel, msg: string, data?: unknown, operationScopeId?: string) => {
    const execution = getCurrentToolCallExecutionOptions();
    // Registration can follow module activation and withdrawal can precede the
    // first log. The registry owns that history independently of log traffic.
    const runtimeOwned = providerRegistry.hasRegistered(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE);
    const resolveRuntimeScope = execution?.resolveRuntimeScope ?? (runtimeOwned
      ? (scopeId: string) => providerRegistry.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)?.resolve(scopeId)
        ?? { ok: false as const, scopeId }
      : undefined);
    // An explicit operation identity overrides both the invocation and activation scope.
    const scope = operationScopeId !== undefined
      ? {
          scopeId: operationScopeId,
          scopeRoot: resolveRuntimeScope ? undefined : execution?.scopeRoot ?? params.scopeRoot,
          resolveRuntimeScope,
        }
      : execution !== undefined
        ? { scopeId: execution.scopeId, scopeRoot: execution.scopeRoot, resolveRuntimeScope }
        : { scopeRoot: params.scopeRoot, resolveRuntimeScope };
    // Scope-less activation diagnostics remain on the host's terminal stream.
    if (scope.scopeId === undefined && scope.scopeRoot === undefined) return;
    const resolved = resolveModuleLogStore(scope);
    if (resolved.ok) resolved.store.append(moduleName ?? "_default", level, msg, data);
    else printTerminalDiagnostic(formatLine("warn", prefix, resolved.error), "warn");
  };
  const log = {
    info: (msg: string, data?: unknown) => {
      printTerminalDiagnostic(formatLine("info", prefix, msg, data));
      appendLog("info", msg, data);
    },
    warn: (msg: string, data?: unknown) => {
      printTerminalDiagnostic(formatLine("warn", prefix, msg, data), "warn");
      appendLog("warn", msg, data);
    },
    error: (msg: string, data?: unknown) => {
      printTerminalDiagnostic(formatLine("error", prefix, msg, data), "error");
      appendLog("error", msg, data);
    },
    operationFailed: (
      scopeId: string,
      operation: string,
      msg: string,
      data?: unknown,
    ) => {
      const observationData = { scopeId, operation, detail: data };
      printTerminalDiagnostic(formatLine("error", prefix, msg, observationData), "error");
      appendLog("error", msg, observationData, scopeId);
      if (moduleName !== undefined) {
        const identity = classifyModuleOperationFailure({
          module: moduleName,
          operation,
          message: msg,
        });
        const key = JSON.stringify([scopeId, operation]);
        const pending = pendingOperationFailures.get(key) ?? new Map();
        pending.set(JSON.stringify(identity), identity);
        pendingOperationFailures.set(key, pending);
        getBus()?.emit("module.operation.failed", {
          scopeId,
          module: moduleName,
          operation,
          ...identity,
          observedAt: new Date().toISOString(),
        });
      }
    },
    operationRecovered: (
      scopeId: string,
      operation: string,
      msg?: string,
      data?: unknown,
      failures?: readonly ModuleOperationFailureIdentity[],
    ) => {
      const message = msg ?? `${operation} recovered`;
      const observationData = { scopeId, operation, detail: data };
      printTerminalDiagnostic(formatLine("info", prefix, message, observationData));
      appendLog("info", message, observationData, scopeId);
      if (moduleName !== undefined) {
        const key = JSON.stringify([scopeId, operation]);
        const recovered = new Map(pendingOperationFailures.get(key));
        for (const identity of failures ?? []) recovered.set(JSON.stringify(identity), identity);
        getBus()?.emit("module.operation.recovered", {
          scopeId,
          module: moduleName,
          operation,
          failures: [...recovered.values()],
          observedAt: new Date().toISOString(),
        });
        pendingOperationFailures.delete(key);
      }
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) printTerminalDiagnostic(formatLine("debug", prefix, msg, data), "debug");
      appendLog("debug", msg, data);
    },
  };
  return {
    cwd,
    verbose,
    config,
    storage,
    registerGroup: (name, toolNames, pattern) => {
      assertRegistrationOpen();
      trackRegistration(registerCustomGroup(name, toolNames, pattern));
    },
    getRoutes,
    getContributedControlRoutes,
    getContributedWorkflows,
    getContributedChannels,
    getContributedUiSurfaces,
    getModuleSummaries,
    getModuleConfig: <T = Record<string, unknown>>(): T | undefined => {
      if (!moduleName) return undefined;
      return config.modules?.[moduleName] as T | undefined;
    },
    log,
    getSecret: (key: string): string | null => secretStore.get(key),
    listTools: (): string[] => {
      return getRegisteredTools().map((t) => t.name);
    },
    events: createEventProxy(getBus, assertRegistrationOpen, trackEventSubscription),
    createSession: (opts?: CreateSessionOptions): ModuleSession => {
      const sessionFactory = getSessionFactory();
      if (!sessionFactory) {
        throw new Error("Session factory not available. createSession() can only be used during agent sessions, not CLI commands.");
      }
      return sessionFactory({
        ...opts,
        ...(opts?.continuityKey === undefined ? {} : {
          continuityKey: `module:${JSON.stringify([moduleName, opts.continuityKey])}`,
        }),
      });
    },
    registerProvider: <T>(token: ProviderToken<T>, provider: T): void => {
      assertRegistrationOpen();
      if (!moduleName) {
        log.warn(`Cannot register provider without a module name`);
        return;
      }
      providerRegistry.register(token, moduleName, provider);
      log.info(`Registered as provider for "${token}"`);
    },
    getProvider: <T>(token: ProviderToken<T>): T | null => {
      return providerRegistry.get(token);
    },
    listProviders: <T>(token: ProviderToken<T>): readonly T[] => {
      return providerRegistry.list(token).flatMap((name) => {
        const provider = providerRegistry.getByName(token, name);
        return provider ? [provider] : [];
      });
    },
    callTool,
    registerMiddleware: (name, fn, priority) => {
      assertRegistrationOpen();
      trackRegistration(getToolMiddleware().add(name, fn, { priority }));
    },
    registerDynamicStateProvider: (name, fn) => {
      assertRegistrationOpen();
      trackRegistration(registerDynamicStateProvider(name, fn));
    },
    registerCleanupHook: (fn) => {
      assertRegistrationOpen();
      trackRegistration(registerCleanupHook(fn));
    },
    registerPreSendHook: (name, fn) => {
      assertRegistrationOpen();
      trackRegistration(registerPreSendHookImpl(name, fn));
    },
    registerHarnessHook: (registration) => {
      assertRegistrationOpen();
      const owner = moduleName ?? "_default";
      if (registration.kind === "preRun") {
        trackRegistration(registerHarnessHookImpl({
          kind: "preRun",
          owner,
          name: registration.name,
          handler: registration.handler as PreRunHook,
        }));
      } else {
        trackRegistration(registerHarnessHookImpl({
          kind: "postRun",
          owner,
          name: registration.name,
          handler: registration.handler as PostRunHook,
        }));
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
