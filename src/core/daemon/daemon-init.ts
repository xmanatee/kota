import { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import {
  getProviderRegistry,
  HISTORY_PROJECT_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
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
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { createChatHistoryProviderResolver } from "./daemon-chat-history-provider.js";
import { DaemonControlServer, type InteractiveSession } from "./daemon-control.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type {
  BuildDaemonInitParams,
  DaemonRuntimeContext,
} from "./daemon-runtime-context.js";
import {
  WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE,
  type WorkflowMetricsSource,
} from "./metrics-source-provider.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "./project-scope-provider.js";
import { inspectChannelScopeDrainBlockers } from "./scope-channel-drain-inspection.js";
import { inspectExternalScopeDrainBlockers } from "./scope-drain-inspection.js";
import { ScopeLifecycleService } from "./scope-lifecycle.js";
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
    projectDir,
    stateDir,
    stateRoot,
    bus,
    logger,
    log,
    state,
    token,
    eventJournal,
    uninstallEventJournal,
    projectRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    projectRuntimes,
  } = params;
  const sessions = new Map<string, InteractiveSession>();

  // Closures inside the handle and provider seams reference `ctx` — they
  // resolve lazily when invoked, so the variable is fully assigned before
  // any of them runs.
  let ctx!: DaemonRuntimeContext;

  const defaultBundle = projectRuntimes.getDefault();
  const workflows = defaultBundle.workflowRuntime, runStore = defaultBundle.runStore;
  const scopeRuntimeHost = new ScopeRuntimeHost({
    bus,
    pollIntervalMs: config.pollIntervalMs ?? 30_000,
    onDueItems: (_runtime, items) => {
      if (!ctx.running || ctx.stopping) return;
      for (const item of items) log(`Reminder: ${item.description}`);
    },
    onLog: log,
    alertCooldownMs: config.config?.notifications?.alertCooldownMs,
    getWorkflowNotify: (runtime, name) =>
      runtime.workflowRuntime.getDefinitions().find((definition) => definition.name === name)?.notify,
  });
  const scopeLifecycle = new ScopeLifecycleService({
    registry: projectRegistry,
    runtimes: projectRuntimes,
    runtimeHost: scopeRuntimeHost,
    bus,
    listSessionIds: (scopeId) => {
      const ids = new Set(
        [...sessions.values()]
          .filter((session) => session.projectId === scopeId)
          .map((session) => session.id),
      );
      for (const id of ctx.controlServer.listChatSessionIds(scopeId)) ids.add(id);
      return [...ids];
    },
    inspectExternalBlockers: (scope) => [
      ...inspectExternalScopeDrainBlockers(
        getProviderRegistry(),
        {
          projectId: scope.scopeId,
          projectDir: scope.directoryRoot,
          displayName: scope.displayName,
        },
      ),
      ...inspectChannelScopeDrainBlockers(ctx.activeChannels, scope.scopeId),
    ],
  });
  const daemonModel = config.model ?? config.config?.model;
  const daemonVerbose = config.verbose;
  const getDefaultWorkflows = () => projectRuntimes.getDefault().workflowRuntime;
  const chatBindings = new DaemonChatBindingStore(stateDir);
  const historyProjectProvider = getProviderRegistry()?.get(HISTORY_PROJECT_PROVIDER_TOKEN);
  const resolveChatHistoryProvider = createChatHistoryProviderResolver({
    projectRuntimes,
    historyProjectProvider,
  });
  const conversationResolver = {
    conversationExists: (conversationId: string, projectId: string): boolean => {
      try {
        return resolveChatHistoryProvider(projectId).load(conversationId) !== null;
      } catch {
        // History module not loaded (no session active yet). Treat as
        // "not found" — the caller will decide whether to create a fresh
        // conversation or error.
        return false;
      }
    },
    createConversation: (_mode: AutonomyMode, projectId: string): string =>
      resolveChatHistoryProvider(projectId).create(
        daemonModel ?? resolveActivePresetFromConfig(config.config).defaultModel,
        projectRuntimes.get(projectId).project.projectDir,
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
    projectDir,
    projectRegistry,
    scopeAuthority,
    scopeAuthorityOperatorVerifier,
    projectRuntimes,
    getScopeHostingState: (scopeId) => scopeLifecycle.getHostingState(scopeId),
    config,
    refreshLiveSessionGuardrails: (guardrailsConfig) =>
      ctx.controlServer.refreshChatSessionGuardrails(guardrailsConfig),
    log,
    getModuleSummaries: () => config.getModuleSummaries?.() ?? [],
    getModuleHealthChecks: () => ctx.moduleHealthChecks,
    probeCapabilityReadiness: () => probeCapabilityReadinessWithTrigger(getDefaultWorkflows()),
    getChannelStatuses: () => ctx.channelStatuses,
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
  const registry = getProviderRegistry();
  if (registry) {
    registry.register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "daemon", {
      getProjectRegistryProjection: () => handle.getProjectRegistryProjection(),
      getActiveProjectId: () => handle.getActiveProjectId(),
      resolveProjectRuntime: (projectId) => {
        const requested = projectId?.trim();
        const resolvedProjectId =
          requested && requested.length > 0
            ? requested
            : handle.getActiveProjectId();
        if (resolvedProjectId !== null && resolvedProjectId !== undefined) {
          if (!handle.hasProject(resolvedProjectId)) {
            return {
              ok: false,
              error: {
                error: "Unknown project",
                reason: "unknown_project",
                projectId: resolvedProjectId,
              },
            };
          }
          return { ok: true, runtime: projectRuntimes.get(resolvedProjectId) };
        }
        return { ok: true, runtime: projectRuntimes.getDefault() };
      },
    });
    registry.register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "daemon", dispatcher);
    registry.register(WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE, "daemon", eventDispatcher);
    registry.register(WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE, "daemon", metricsSource);
    registry.register(WORKFLOW_DEFINITIONS_PROVIDER_TYPE, "daemon", definitionsSource);
  }

  const controlServer = new DaemonControlServer(handle, token, {
    eventBufferSize: config.config?.daemon?.eventBufferSize,
    makeAgent: (transport: Transport, autonomyMode, resumeConversation, projectId) => {
      const runtime = projectRuntimes.get(projectId);
      return new AgentSession({
        autonomyMode,
        model: daemonModel,
        verbose: daemonVerbose,
        transport,
        config: config.config,
        resumeConversation,
        projectDir: runtime.project.projectDir,
        projectRuntime: runtime,
      });
    },
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
    projectDir,
    stateDir,
    stateRoot,
    bus,
    eventJournal,
    uninstallEventJournal,
    runStore,
    workflows,
    controlServer,
    handle,
    token,
    state,
    sessions,
    projectRegistry,
    scopeAuthority,
    projectRuntimes,
    scopeLifecycle,
    scopeRuntimeHost,
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
