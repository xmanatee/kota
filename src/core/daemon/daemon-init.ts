import type { Transport } from "#core/loop/transport.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { moduleSetupRequirementsFromSummaries } from "#core/modules/module-setup-status.js";
import {
  HISTORY_PROVIDER_TOKEN,
  HISTORY_SCOPE_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import { ModuleSetupService } from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  createRunStateReader,
  RUN_STATE_READER_PROVIDER_TYPE,
} from "#core/workflow/run-state-reader-provider.js";
import {
  WORKFLOW_DEFINITIONS_PROVIDER_TYPE,
  type WorkflowDefinitionsSource,
} from "#core/workflow/workflow-definitions-provider.js";
import {
  WORKFLOW_DISPATCHER_PROVIDER_TYPE,
  type WorkflowDispatcher,
} from "#core/workflow/workflow-dispatcher-provider.js";
import {
  WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE,
  type WorkflowEventDispatcher,
} from "#core/workflow/workflow-event-dispatcher-provider.js";
import { probeCapabilityReadinessWithTrigger } from "./capability-readiness.js";
import { createDaemonAgentSessionFactories } from "./daemon-agent-session-factory.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { createChatHistoryProviderResolver } from "./daemon-chat-history-provider.js";
import { DaemonControlServer, type InteractiveSession } from "./daemon-control.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type {
  BuildDaemonInitParams,
  DaemonRuntimeContext,
} from "./daemon-runtime-context.js";
import { DaemonEventLoopLatencyMonitor } from "./event-loop-latency.js";
import {
  WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE,
  type WorkflowMetricsSource,
} from "./metrics-source-provider.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "./runtime-scope-provider.js";
import { inspectChannelScopeDrainBlockers } from "./scope-channel-drain-inspection.js";
import { inspectExternalScopeDrainBlockers } from "./scope-drain-inspection.js";
import { ScopeLifecycleService } from "./scope-lifecycle.js";
import { ScopeOnboardingService } from "./scope-onboarding.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "./scope-provider.js";
import { ScopeRuntimeHost } from "./scope-runtime-host.js";

export type { BuildDaemonInitParams, DaemonRuntimeContext } from "./daemon-runtime-context.js";

/**
 * Build the daemon's lifecycle context: construct the workflow runtime,
 * daemon-control handle, provider-seam registrations, and the control
 * server. Lifecycle-time mutable fields start in their resting state
 * (no timers, no subscriptions, empty channel state) and are populated
 * during `runDaemonStartup`.
 */
export function buildDaemonInit(params: BuildDaemonInitParams): DaemonRuntimeContext {
  const {
    config,
    scopeRoot,
    stateDir,
    stateRoot,
    bus,
    logger,
    log,
    state,
    token,
    eventJournal,
    runState,
    runCoordinator,
    uninstallEventJournal,
    scopeRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    scopeRuntimes,
    collector,
    startupDispatchPaused,
  } = params;
  const sessions = new Map<string, InteractiveSession>();
  const eventLoopLatency = new DaemonEventLoopLatencyMonitor();
  const providerRegistry = config.runtimeModuleHost?.moduleLoader.getProviderRegistry();

  // Closures inside the handle and provider seams reference `ctx` — they
  // resolve lazily when invoked, so the variable is fully assigned before
  // any of them runs.
  let ctx!: DaemonRuntimeContext;

  const defaultBundle = scopeRuntimes.getDefault();
  const workflows = defaultBundle.workflowRuntime, runStore = defaultBundle.runStore;
  const scopeRuntimeHost = new ScopeRuntimeHost({
    bus,
    pollIntervalMs: config.pollIntervalMs ?? 30_000,
    onDueItems: (_runtime, items) => {
      if (!ctx.running || ctx.stopping) return;
      for (const item of items) log(`Reminder: ${item.description}`);
    },
  });
  const scopeLifecycle = new ScopeLifecycleService({
    registry: scopeRegistry,
    runState,
    runtimes: scopeRuntimes,
    runtimeHost: scopeRuntimeHost,
    bus,
    listSessionIds: (scopeId) => {
      const ids = new Set(
        [...sessions.values()]
          .filter((session) => session.scopeId === scopeId)
          .map((session) => session.id),
      );
      for (const id of ctx.controlServer.listChatSessionIds(scopeId)) ids.add(id);
      return [...ids];
    },
    inspectExternalBlockers: (scope) => [
      ...inspectExternalScopeDrainBlockers(
        providerRegistry ?? null,
        {
          scopeId: scope.scopeId,
          scopeRoot: scope.directoryRoot,
          displayName: scope.displayName,
        },
      ),
      ...inspectChannelScopeDrainBlockers(ctx.activeChannels, scope.scopeId),
    ],
  });
  const daemonModel = config.model ?? config.config?.model;
  const getDefaultWorkflows = () => scopeRuntimes.getDefault().workflowRuntime;
  const scopeOnboarding = new ScopeOnboardingService({
    stateDir,
    registry: scopeRegistry,
    lifecycle: scopeLifecycle,
    authority: scopeAuthority,
    getSetupStatus: (directoryRoot, scopeId) => {
      const setupService = new ModuleSetupService({
        scopeRoot: directoryRoot,
        ...(config.authorityConfigPath !== undefined
          ? { authorityConfigPath: config.authorityConfigPath }
          : {}),
        getRequirements: () =>
          moduleSetupRequirementsFromSummaries(config.getModuleSummaries?.() ?? []),
        probeCapabilities: async () => (
          await probeCapabilityReadinessWithTrigger(
            scopeId === undefined
              ? getDefaultWorkflows()
              : scopeRuntimes.get(scopeId).workflowRuntime,
            providerRegistry,
          )
        ).capabilities,
        getVisibility: () => scopeId === undefined
          ? "full"
          : scopeAuthority.getSnapshot(scopeId).policy.setup.visibility,
      });
      return setupService.inspect();
    },
    isInitialImprovementAvailable: (scopeId) => {
      const enabled = new Set(
        scopeRuntimes.get(scopeId).workflowRuntime.getDefinitions()
          .filter((definition) => definition.enabled)
          .map((definition) => definition.name),
      );
      return enabled.has("scope-improvement-onboarding") && enabled.has("scope-improver");
    },
    isDispatchAvailable: () => !startupDispatchPaused && !ctx.restartRequested,
  });
  const chatBindings = new DaemonChatBindingStore(stateDir);
  const historyScopeProvider = providerRegistry?.get(HISTORY_SCOPE_PROVIDER_TOKEN);
  const resolveChatHistoryProvider = createChatHistoryProviderResolver({
    scopeRuntimes,
    historyScopeProvider,
    defaultHistoryProvider: providerRegistry?.get(HISTORY_PROVIDER_TOKEN),
  });
  const conversationResolver = {
    conversationExists: (conversationId: string, scopeId: string): boolean => {
      try {
        return resolveChatHistoryProvider(scopeId).load(conversationId) !== null;
      } catch {
        // History module not loaded (no session active yet). Treat as
        // "not found" — the caller will decide whether to create a fresh
        // conversation or error.
        return false;
      }
    },
    createConversation: (_mode: AutonomyMode, scopeId: string): string =>
      resolveChatHistoryProvider(scopeId).create(
        daemonModel ?? resolveActivePresetFromConfig(config.config).defaultModel,
        scopeRuntimes.get(scopeId).scope.scopeRoot,
        "user",
      ),
  };

  const handle = buildDaemonHandle({
    getState: () => ctx.state,
    isRunning: () => ctx.running && !ctx.stopping,
    workflows,
    bus,
    sessions,
    runStore,
    scopeRoot,
    scopeRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    scopeOnboarding,
    scopeRuntimes,
    getScopeHostingState: (scopeId) => scopeLifecycle.getHostingState(scopeId),
    config,
    refreshLiveSessionGuardrails: (guardrailsConfig) =>
      ctx.controlServer.refreshChatSessionGuardrails(guardrailsConfig),
    log,
    getModuleSummaries: () => config.getModuleSummaries?.() ?? [],
    getModuleHealthChecks: () => ctx.moduleHealthChecks,
    getEventLoopLatency: () => ctx.eventLoopLatency.snapshot(),
    probeCapabilityReadiness: () =>
      probeCapabilityReadinessWithTrigger(getDefaultWorkflows(), providerRegistry),
    getChannelStatuses: () => ctx.channelStatuses,
    collector,
  });

  // Register the workflow-dispatcher / metrics-source / definitions seams so
  // module-contributed daemon-control routes can enqueue runs and read live
  // workflow state without holding a DaemonControlHandle. Registrations fire
  // from daemon constructor time so module routes that consume the seams find
  // them ready before the control server starts.
  const dispatcher: WorkflowDispatcher = {
    enqueuePendingRun: (name) => handle.enqueuePendingRun(name),
    enqueueWebhookRun: (name, payload) => {
      const result = getDefaultWorkflows().enqueueWebhookRun(name, payload);
      if (result.error?.startsWith("Unknown workflow") || result.error?.includes("no webhook trigger")) {
        return { ok: false, notFound: true };
      }
      return result;
    },
    execute: (request) =>
      scopeRuntimes.get(request.scopeId).workflowRuntime.execute(request),
  };
  const eventDispatcher: WorkflowEventDispatcher = {
    enqueueBatchedEvent: (input) => getDefaultWorkflows().enqueueBatchedEvent(input),
  };
  const metricsSource: WorkflowMetricsSource = {
    getWorkflowMetricCounts: () => handle.getWorkflowMetricCounts(),
    listSessions: () => handle.listSessions(),
    getWorkflowLiveStatus: () => handle.getWorkflowLiveStatus(),
  };
  const definitionsSource: WorkflowDefinitionsSource = {
    getWebhookRateLimit: (name) => {
      const def = getDefaultWorkflows().getDefinitions().find((d) => d.name === name);
      return def?.webhookRateLimit;
    },
  };
  const registry = providerRegistry;
  if (registry) {
    registry.register(
      RUN_STATE_READER_PROVIDER_TYPE,
      "daemon",
      createRunStateReader(runState),
    );
    registry.register(DAEMON_SCOPE_PROVIDER_TYPE, "daemon", {
      getScopeRegistryProjection: () => handle.getScopeRegistryProjection(),
      getActiveScopeId: () => handle.getActiveScopeId(),
      resolveScopeRuntime: (scopeId) => {
        const requested = scopeId?.trim();
        const resolvedScopeId =
          requested && requested.length > 0
            ? requested
            : handle.getActiveScopeId();
        if (resolvedScopeId !== null && resolvedScopeId !== undefined) {
          if (!handle.hasScope(resolvedScopeId)) {
            return {
              ok: false,
              error: {
                error: "Unknown scope",
                reason: "unknown_scope",
                scopeId: resolvedScopeId,
              },
            };
          }
          return { ok: true, runtime: scopeRuntimes.get(resolvedScopeId) };
        }
        return { ok: true, runtime: scopeRuntimes.getDefault() };
      },
    });
    registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "daemon", {
      resolve: (scopeId) => {
        try {
          return { ok: true, runtime: scopeRuntimes.get(scopeId) };
        } catch {
          return { ok: false, scopeId };
        }
      },
    });
    registry.register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "daemon", dispatcher);
    registry.register(WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE, "daemon", eventDispatcher);
    registry.register(WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE, "daemon", metricsSource);
    registry.register(WORKFLOW_DEFINITIONS_PROVIDER_TYPE, "daemon", definitionsSource);
  }

  const { makeAgentSession, createModuleSession } =
    createDaemonAgentSessionFactories(config, scopeRuntimes, resolveChatHistoryProvider);
  config.runtimeModuleHost?.moduleLoader.setSessionFactory(createModuleSession);

  const controlServer = new DaemonControlServer(handle, token, {
    eventBufferSize: config.config?.daemon?.eventBufferSize,
    makeAgent: (transport: Transport, autonomyMode, resumeConversation, scopeId) =>
      makeAgentSession(transport, autonomyMode, scopeId, { resumeConversation }),
    defaultAutonomyMode: config.config?.serve?.defaultAutonomyMode,
    chatPool: { ttlMs: config.config?.daemon?.sessionIdleTtlMs },
    chatBindings,
    conversationResolver,
    controlRoutes: config.controlRoutes,
    routes: config.routes,
    eventJournal,
  });

  ctx = {
    config,
    logger,
    log,
    scopeRoot,
    stateDir,
    stateRoot,
    bus,
    eventJournal,
    runState,
    runCoordinator,
    uninstallEventJournal,
    runStore,
    workflows,
    controlServer,
    handle,
    token,
    state,
    sessions,
    scopeRegistry,
    scopeAuthority,
    scopeRuntimes,
    scopeLifecycle,
    scopeOnboarding,
    scopeRuntimeHost,
    collector,
    eventLoopLatency,
    startupDispatchPaused,
    unsubscribe: null,
    sessionSweepTimer: null,
    healthCheckTimer: null,
    shutdownHandler: null,
    activeChannels: [],
    channelStatuses: [],
    moduleHealthChecks: {},
    running: false,
    stopping: false,
    restartRequested: false,
    restartReason: null,
  };

  return ctx;
}
