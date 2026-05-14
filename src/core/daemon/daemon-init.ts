import type { ChannelAdapter, ChannelStatus } from "#core/channels/channel.js";
import type { EventBus } from "#core/events/event-bus.js";
import { AgentSession } from "#core/loop/loop.js";
import type { Transport } from "#core/loop/transport.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import type { HealthCheckResult } from "#core/modules/module-types.js";
import { getHistoryProvider, getProviderRegistry } from "#core/modules/provider-registry.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import {
  WORKFLOW_DEFINITIONS_PROVIDER_TYPE,
  type WorkflowDefinitionsSource,
} from "#core/workflow/workflow-definitions-provider.js";
import {
  WORKFLOW_DISPATCHER_PROVIDER_TYPE,
  type WorkflowDispatcher,
} from "#core/workflow/workflow-dispatcher-provider.js";
import {
  type CapabilityReadinessResponse,
  probeCapabilityReadiness,
} from "./capability-readiness.js";
import type { DaemonConfig } from "./daemon.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { DaemonControlServer, type InteractiveSession } from "./daemon-control.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { buildDaemonHandle } from "./daemon-handle.js";
import type { DaemonLogger } from "./daemon-logger.js";
import type { DaemonState } from "./daemon-state.js";
import {
  WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE,
  type WorkflowMetricsSource,
} from "./metrics-source-provider.js";
import type { ProjectRegistry } from "./project-registry.js";
import type { ProjectRuntimeRegistry } from "./project-runtime.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "./project-scope-provider.js";

/**
 * Per-instance lifecycle context for one running daemon.
 *
 * `daemon.ts` constructs one of these via {@link buildDaemonInit} and stores
 * it as the daemon's single state container. Lifecycle-phase helpers
 * (`runDaemonStartup`, `runDaemonShutdown`, `startChannel`) take this
 * context and read or mutate its fields directly. The class wraps the
 * context and exposes the daemon's public surface.
 */
export type DaemonRuntimeContext = {
  // Initialization-time references; not reassigned after construction.
  readonly config: DaemonConfig;
  readonly logger: DaemonLogger;
  readonly log: (message: string) => void;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly bus: EventBus;
  readonly runStore: WorkflowRunStore;
  readonly workflows: WorkflowRuntime;
  readonly controlServer: DaemonControlServer;
  readonly handle: DaemonControlHandle;
  readonly token: string;
  readonly state: DaemonState;
  readonly sessions: Map<string, InteractiveSession>;
  readonly projectRegistry: ProjectRegistry;
  readonly projectRuntimes: ProjectRuntimeRegistry;

  // Mutable lifecycle state owned by startup/shutdown phases.
  unsubscribe: (() => void) | null;
  sessionSweepTimer: ReturnType<typeof setInterval> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  shutdownHandler: ((signal?: NodeJS.Signals) => void) | null;
  activeChannels: ChannelAdapter[];
  channelStatuses: ChannelStatus[];
  moduleHealthChecks: Record<string, HealthCheckResult>;

  // Restart and run-state flags driven by start/stop.
  running: boolean;
  stopping: boolean;
  restartRequested: boolean;
  restartReason: string | null;
};

export type BuildDaemonInitParams = {
  config: DaemonConfig;
  projectDir: string;
  stateDir: string;
  bus: EventBus;
  logger: DaemonLogger;
  log: (message: string) => void;
  state: DaemonState;
  token: string;
  projectRegistry: ProjectRegistry;
  projectRuntimes: ProjectRuntimeRegistry;
};

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
    bus,
    logger,
    log,
    state,
    token,
    projectRegistry,
    projectRuntimes,
  } = params;
  const sessions = new Map<string, InteractiveSession>();

  // Closures inside the handle and provider seams reference `ctx` — they
  // resolve lazily when invoked, so the variable is fully assigned before
  // any of them runs.
  let ctx!: DaemonRuntimeContext;

  const defaultBundle = projectRuntimes.getDefault();
  const workflows = defaultBundle.workflowRuntime;
  const runStore = defaultBundle.runStore;

  const daemonModel = config.model ?? config.config?.model;
  const daemonConfig = config.config;
  const daemonVerbose = config.verbose;
  const chatBindings = new DaemonChatBindingStore(stateDir);
  const conversationResolver = {
    conversationExists: (conversationId: string): boolean => {
      try {
        return getHistoryProvider().load(conversationId) !== null;
      } catch {
        // History module not loaded (no session active yet). Treat as
        // "not found" — the caller will decide whether to create a fresh
        // conversation or error.
        return false;
      }
    },
    createConversation: (_mode: AutonomyMode): string =>
      getHistoryProvider().create(
        daemonModel ?? resolveActivePresetFromConfig(daemonConfig).defaultModel,
        projectDir,
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
    projectRuntimes,
    config: { config: config.config, verbose: config.verbose },
    log,
    getModuleHealthChecks: () => ctx.moduleHealthChecks,
    probeCapabilityReadiness: () => probeCapabilityReadinessWithTrigger(workflows),
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
      const result = workflows.enqueueWebhookRun(name, payload);
      if (result.error?.startsWith("Unknown workflow") || result.error?.includes("no webhook trigger")) {
        return { ok: false, notFound: true };
      }
      return result;
    },
  };
  const metricsSource: WorkflowMetricsSource = {
    getWorkflowMetricCounts: () => handle.getWorkflowMetricCounts(),
    listSessions: () => handle.listSessions(),
    getWorkflowLiveStatus: () => handle.getWorkflowLiveStatus(),
  };
  const definitionsSource: WorkflowDefinitionsSource = {
    getWebhookRateLimit: (name) => {
      const def = workflows.getDefinitions().find((d) => d.name === name);
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
    registry.register(WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE, "daemon", metricsSource);
    registry.register(WORKFLOW_DEFINITIONS_PROVIDER_TYPE, "daemon", definitionsSource);
  }

  const controlServer = new DaemonControlServer(handle, token, {
    eventBufferSize: config.config?.daemon?.eventBufferSize,
    makeAgent: (transport: Transport, autonomyMode, resumeConversation) =>
      new AgentSession({
        autonomyMode,
        model: daemonModel,
        verbose: daemonVerbose,
        transport,
        config: daemonConfig,
        resumeConversation,
      }),
    defaultAutonomyMode: config.config?.serve?.defaultAutonomyMode,
    chatPool: { ttlMs: config.config?.daemon?.sessionIdleTtlMs },
    chatBindings,
    conversationResolver,
    controlRoutes: config.controlRoutes,
    routes: config.routes,
  });

  ctx = {
    config,
    logger,
    log,
    projectDir,
    stateDir,
    bus,
    runStore,
    workflows,
    controlServer,
    handle,
    token,
    state,
    sessions,
    projectRegistry,
    projectRuntimes,
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

/**
 * Aggregate the registry-backed capability-readiness probe with the
 * daemon-owned `workflow.trigger` row. Behaviour matches the previous
 * inline aggregation in the daemon constructor — empty-definitions,
 * all-disabled, and partial-enabled paths are all covered by
 * `capability-readiness.test.ts`.
 */
async function probeCapabilityReadinessWithTrigger(
  workflows: WorkflowRuntime,
): Promise<CapabilityReadinessResponse> {
  const registry = getProviderRegistry();
  const aggregated = registry
    ? await probeCapabilityReadiness(registry)
    : { capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } };
  const definitions = workflows.getDefinitions();
  const enabled = definitions.filter((d) => d.enabled).length;
  const triggerReadiness = enabled > 0
    ? {
        id: "workflow.trigger",
        moduleName: "core",
        status: "ready" as const,
        message: `${enabled} of ${definitions.length} workflow definition(s) currently enabled.`,
        meta: { enabled, total: definitions.length },
      }
    : {
        id: "workflow.trigger",
        moduleName: "core",
        status: "unavailable" as const,
        reason: "no_enabled_workflows",
        message:
          definitions.length === 0
            ? "No workflow definitions are loaded."
            : `All ${definitions.length} workflow definition(s) are disabled.`,
        meta: { enabled, total: definitions.length },
      };
  const merged = [...aggregated.capabilities, triggerReadiness].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const summary = { ready: 0, unavailable: 0, init_failed: 0 };
  for (const cap of merged) summary[cap.status] += 1;
  return { capabilities: merged, summary };
}
