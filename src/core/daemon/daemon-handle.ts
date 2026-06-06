import type { ChannelStatus } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import { ModuleSetupService } from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import {
  type GuardrailsConfig,
  getDefaultConfig as getDefaultGuardrails,
} from "#core/tools/guardrails.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";
import { buildClientIdentity, type ClientIdentity } from "./client-identity.js";
import { computeModuleConfigDiff } from "./config-reload-diff.js";
import type { DaemonConfig } from "./daemon.js";
import {
  buildDaemonConfigReloadFailureEvent,
  buildDaemonConfigReloadSuccessEvent,
} from "./daemon-config-reload-event.js";
import type {
  DaemonControlHandle,
  InteractiveSession,
  ModuleHealthCheckResult,
  SetActiveProjectResult,
  WorkflowCostEntry,
  WorkflowDefinitionSummary,
  WorkflowDurationHistogramEntry,
  WorkflowMetricCounts,
  WorkflowRunCountEntry,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
import type { DaemonState } from "./daemon-state.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
import {
  defaultScopePolicyDecisionExamples,
  resolveScopePolicy,
  type ScopePolicyRouteResponse,
} from "./scope-policy.js";
import type {
  ProjectId,
  ProjectRegistryProjection,
  ScopeRegistry,
  ScopeRegistryProjection,
} from "./scope-registry.js";

export type DaemonHandleContext = {
  getState: () => DaemonState;
  isRunning: () => boolean;
  workflows: WorkflowRuntime;
  bus: EventBus;
  sessions: Map<string, InteractiveSession>;
  runStore: WorkflowRunStore;
  projectDir: string;
  projectRegistry: ScopeRegistry;
  projectRuntimes: ProjectRuntimeRegistry;
  config: DaemonConfig;
  refreshLiveSessionGuardrails: (config: GuardrailsConfig) => {
    refreshed: number;
    unchanged: number;
  };
  log: (message: string) => void;
  getModuleHealthChecks: () => Record<string, ModuleHealthCheckResult>;
  probeCapabilityReadiness: () => Promise<CapabilityReadinessResponse>;
  getChannelStatuses: () => readonly ChannelStatus[];
};

export function buildDaemonHandle(ctx: DaemonHandleContext): DaemonControlHandle {
  const {
    bus,
    sessions,
    projectDir,
    projectRegistry,
    projectRuntimes,
    config,
    refreshLiveSessionGuardrails,
    log,
  } = ctx;

  // Per-project metric counts cache. Each project has its own run store,
  // so a single global cache would leak rows across projects.
  const metricCountsCache = new Map<ProjectId, { value: WorkflowMetricCounts; at: number }>();
  const setupService = new ModuleSetupService({
    projectDir,
    getRequirements: () => config.setupRequirements ?? [],
    probeCapabilities: async () => {
      const response = await ctx.probeCapabilityReadiness();
      return response.capabilities;
    },
  });

  // Operator-selected active project id. Lives in-memory only — a daemon
  // restart drops the selection back to the registry default, which matches
  // the rest of the daemon's "config is durable, runtime selection is not"
  // posture. Route handlers consult this through `resolveProjectIdParam`
  // when a request omits `?projectId=`, so a `kota project use <id>` call
  // implicitly scopes subsequent inspection commands to that project.
  let activeProjectId: ProjectId | null = null;

  // Resolve a project's runtime bundle. `projectId` is optional; when
  // omitted, we fall back to the registry's default. Throws on an unknown
  // id — route handlers gate on `hasProject` first, so a thrown lookup
  // here is a programmer error rather than a wire-shape rejection.
  const lookupRuntime = (projectId?: ProjectId): ProjectRuntime => {
    if (projectId === undefined) {
      return projectRuntimes.getDefault();
    }
    return projectRuntimes.get(projectId);
  };

  return {
    getHealthStatus: () => {
      const checks = ctx.getModuleHealthChecks();
      const hasUnhealthy = Object.values(checks).some((c) => c.status === "unhealthy");
      const moduleHealthChecks = Object.keys(checks).length > 0 ? checks : undefined;
      return {
        scheduler: "ok" as const,
        modules: hasUnhealthy ? ("error" as const) : ("ok" as const),
        moduleHealthChecks,
      };
    },
    getDaemonLiveState: () => ({ ...ctx.getState(), running: ctx.isRunning() }),
    listChannelStatuses: () => [...ctx.getChannelStatuses()],
    listModuleSetupStatuses: () => setupService.list(),
    submitModuleSetupForm: (moduleName, requirementId, values) =>
      setupService.submitForm(moduleName, requirementId, values),
    storeModuleSetupSecret: (moduleName, requirementId, secretValues) =>
      setupService.storeSecret(moduleName, requirementId, secretValues),
    startModuleSetup: (moduleName, requirementId) =>
      setupService.start(moduleName, requirementId),
    completeModuleSetup: (actionId, input) =>
      setupService.complete(actionId, input),
    refreshModuleSetup: (moduleName, requirementId) =>
      setupService.refresh(moduleName, requirementId),
    revokeModuleSetup: (moduleName, requirementId) =>
      setupService.revoke(moduleName, requirementId),
    getProjectRegistryProjection: (): ProjectRegistryProjection =>
      projectRegistry.toProjection(),
    getScopeRegistryProjection: (): ScopeRegistryProjection =>
      projectRegistry.toScopeProjection(),
    hasScope: (scopeId: string) =>
      projectRegistry.toScopeProjection().scopes.some((scope) => scope.scopeId === scopeId),
    getScopePolicy: (scopeId: string): ScopePolicyRouteResponse => {
      const policy = resolveScopePolicy({
        projection: projectRegistry.toScopeProjection(),
        scopeId,
        fragments: config.scopePolicies,
      });
      return {
        policy,
        decisionExamples: defaultScopePolicyDecisionExamples(policy),
      };
    },
    hasProject: (projectId: string) => projectRegistry.get(projectId) !== undefined,
    getActiveProjectId: (): ProjectId | null => activeProjectId,
    setActiveProjectId: (next: ProjectId | null): SetActiveProjectResult => {
      if (next === null) {
        activeProjectId = null;
        return { ok: true, activeProjectId: null };
      }
      if (projectRegistry.get(next) === undefined) {
        return { ok: false, reason: "not_found", projectId: next };
      }
      activeProjectId = next;
      return { ok: true, activeProjectId: next };
    },
    getWorkflowLiveStatus: (projectId?: ProjectId) => {
      const workflows = lookupRuntime(projectId).workflowRuntime;
      const wfState = workflows.getState();
      const windowStatus = workflows.getDispatchWindowStatus();
      return {
        activeRuns: wfState.activeRuns ?? [],
        pendingRuns: wfState.pendingRuns,
        queueLength: wfState.queueLength,
        completedRuns: wfState.completedRuns,
        totalCostUsd: wfState.totalCostUsd,
        agentBackoff: wfState.agentBackoff,
        definitionsLoadedAt: wfState.definitionsLoadedAt,
        workflows: wfState.workflows,
        paused: workflows.isDispatchPaused(),
        agentConcurrency: wfState.agentConcurrency,
        codeConcurrency: wfState.codeConcurrency,
        ...(windowStatus.blocked && {
          dispatchWindowBlocked: true,
          dispatchWindowOpensAt: windowStatus.opensAt,
        }),
      };
    },
    pauseWorkflowDispatch: (projectId?: ProjectId) => {
      const workflows = lookupRuntime(projectId).workflowRuntime;
      const already = workflows.isDispatchPaused();
      if (!already) workflows.setDispatchPaused(true, "persistent");
      return { already };
    },
    resumeWorkflowDispatch: (projectId?: ProjectId) => {
      const workflows = lookupRuntime(projectId).workflowRuntime;
      const already = !workflows.isDispatchPaused();
      if (!already) workflows.setDispatchPaused(false, "persistent");
      return { already };
    },
    probeCapabilityReadiness: () => ctx.probeCapabilityReadiness(),
    getClientIdentity: async (): Promise<ClientIdentity> => {
      const capabilities = await ctx.probeCapabilityReadiness();
      const state = ctx.getState();
      return buildClientIdentity({
        projectDir,
        pid: state.pid,
        startedAt: state.startedAt,
        capabilities,
        projects: projectRegistry.toProjection(),
      });
    },
    abortActiveRuns: (projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.abortActiveRuns(),
    abortActiveRun: (runId: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.abortActiveRun(runId),
    reloadWorkflowDefinitions: (projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.reloadWorkflowDefinitions(),
    reloadConfig: async () => {
      // Config reload is daemon-wide today: every project's workflow
      // runtime adopts the same workflow inputs and the same module
      // contributions. When per-project config lands, this method will
      // need to fan out across `projectRuntimes`.
      const currentWorkflowCount = (): number => {
        let count = 0;
        for (const runtime of projectRuntimes.list()) {
          count = runtime.workflowRuntime.getDefinitionCount();
        }
        return count;
      };

      try {
        const oldConfig = config.config ?? {};
        const newConfig = loadConfig(projectDir);
        const loader = await loadModuleMetadata(
          newConfig,
          projectDir,
          config.verbose ?? false,
        );
        config.setupRequirements = loader.getContributedSetupRequirements();
        const allModules = loader.getModuleSummaries().map((s) => ({
          name: s.name,
          dependencies: s.dependencies,
        }));
        const { changedModules, isFullReload } = computeModuleConfigDiff(
          oldConfig,
          newConfig,
          allModules,
        );
        config.config = newConfig;
        const sessionGuardrails = buildSessionGuardrailsReloadSummary(
          refreshLiveSessionGuardrails(resolveInteractiveGuardrailsConfig(newConfig)),
          sessions,
        );
        const inputs = loader.getContributedWorkflows();
        let aggregateCount = 0;
        for (const runtime of projectRuntimes.list()) {
          runtime.workflowRuntime.setWorkflowInputs(inputs);
          aggregateCount = runtime.workflowRuntime.reloadWorkflowDefinitions().count;
        }
        bus.emit("daemon.config.reload", buildDaemonConfigReloadSuccessEvent({
          changedModules,
          isFullReload,
          workflowCount: aggregateCount,
          sessionGuardrails,
        }));
        log(`Config reloaded: ${aggregateCount} workflow definition(s) active`);
        if (isFullReload) {
          log(`  Full reload: all ${changedModules.length} module(s) restarted (global config changed)`);
        } else if (changedModules.length > 0) {
          log(`  Reloaded: ${changedModules.join(", ")}`);
          const skipped = allModules.filter((m) => !changedModules.includes(m.name)).map((m) => m.name);
          if (skipped.length > 0) log(`  Skipped: ${skipped.join(", ")}`);
        } else {
          log("  No module config changes detected");
        }
        if (
          sessionGuardrails.refreshed > 0 ||
          sessionGuardrails.unchanged > 0 ||
          sessionGuardrails.nonRefreshable.length > 0
        ) {
          log(
            `  Session guardrails: ${sessionGuardrails.refreshed} refreshed, ` +
              `${sessionGuardrails.unchanged} unchanged, ` +
              `${sessionGuardrails.nonRefreshable.length} not refreshable`,
          );
        }
        return { workflows: aggregateCount, changedModules, sessionGuardrails };
      } catch (error) {
        bus.emit("daemon.config.reload", buildDaemonConfigReloadFailureEvent({
          errorClass: error instanceof Error ? error.name : typeof error,
          workflowCount: currentWorkflowCount(),
        }));
        throw error;
      }
    },
    getWorkflowDefinitions: (projectId?: ProjectId): WorkflowDefinitionSummary[] => {
      const workflows = lookupRuntime(projectId).workflowRuntime;
      return workflows.getDefinitions().map((def) => {
        const sourceEnabled = workflows.getDefinitionSourceEnabled(def.name);
        const hasOverride = sourceEnabled !== undefined && sourceEnabled !== def.enabled;
        return {
          name: def.name,
          enabled: sourceEnabled !== undefined ? sourceEnabled : def.enabled,
          ...(hasOverride ? { runtimeEnabled: def.enabled } : {}),
          stepCount: def.steps.length,
          triggers: def.triggers.map((t): WorkflowDefinitionSummary["triggers"][number] => {
            if (t.webhook) return { type: "webhook" };
            if (t.watch) return { type: "watch", patterns: t.watch, debounceMs: t.debounceMs ?? 500 };
            if (t.schedule) return { type: "cron", schedule: t.schedule };
            if (t.intervalMs != null) return { type: "interval", intervalMs: t.intervalMs };
            return { type: "event", event: t.event, ...(t.filter ? { filter: t.filter as Record<string, string | string[]> } : {}) };
          }),
          ...(def.inputSchema !== undefined ? { inputSchema: def.inputSchema } : {}),
          ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
        };
      });
    },
    enableWorkflow: (name: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.enableWorkflow(name),
    disableWorkflow: (name: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.disableWorkflow(name),
    enqueuePendingRun: (
      name: string,
      tags?: string[],
      extraPayload?: Record<string, unknown>,
      projectId?: ProjectId,
    ) => lookupRuntime(projectId).workflowRuntime.enqueuePendingRun(name, tags, extraPayload),
    cancelQueuedRun: (runId: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.cancelQueuedRun(runId),
    subscribeToEvents: (handler) => {
      const stops = [
        bus.on("workflow.started", (p) => {
          handler({ type: "workflow.started", payload: p });
          handler({ type: "queue.changed", payload: { source: "workflow.started", workflow: p.workflow } });
        }),
        bus.on("workflow.completed", (p) => {
          handler({ type: "workflow.completed", payload: p });
          handler({ type: "queue.changed", payload: { source: "workflow.completed", workflow: p.workflow, status: p.status } });
        }),
        bus.on("workflow.step.completed", (p) =>
          handler({ type: "workflow.step.completed", payload: p }),
        ),
        bus.on("daemon.config.reload", (p) =>
          handler({ type: "daemon.config.reload", payload: p }),
        ),
        bus.on("approval.changed", (p) =>
          handler({ type: "approval.changed", payload: p }),
        ),
        bus.on("task.changed", (p) =>
          handler({ type: "task.changed", payload: p }),
        ),
        bus.on("session.registered", (p) =>
          handler({ type: "session.registered", payload: p }),
        ),
        bus.on("session.unregistered", (p) =>
          handler({ type: "session.unregistered", payload: p }),
        ),
        bus.on("owner.question.asked", (p) =>
          handler({ type: "owner.question.asked", payload: p }),
        ),
        bus.on("owner.question.changed", (p) =>
          handler({ type: "owner.question.changed", payload: p }),
        ),
        bus.on("owner.question.resolved", (p) =>
          handler({ type: "owner.question.resolved", payload: p }),
        ),
        bus.on("owner.question.dismissed", (p) =>
          handler({ type: "owner.question.dismissed", payload: p }),
        ),
        bus.on("owner.question.expired", (p) =>
          handler({ type: "owner.question.expired", payload: p }),
        ),
      ];
      return () => stops.forEach((s) => s());
    },
    listWorkflowRuns: (
      opts?: { workflow?: string; limit?: number; tag?: string; causedByRunId?: string; projectId?: ProjectId },
    ): WorkflowRunSummary[] => {
      const { workflow, limit, tag, causedByRunId, projectId } = opts ?? {};
      const runStore = lookupRuntime(projectId).runStore;
      return runStore.listRuns({ workflow, limit, tag, causedByRunId }).map((m) => ({
        id: m.id,
        workflow: m.workflow,
        status: m.status,
        triggerEvent: m.trigger.event,
        triggerSchemaRef: m.trigger.schemaRef,
        startedAt: m.startedAt,
        ...(m.durationMs != null && { durationMs: m.durationMs }),
        ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
        ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
        ...(m.causedBy != null && { causedBy: m.causedBy }),
        ...(m.retryOf != null && { retryOf: m.retryOf }),
        ...(m.resumedFromRunId != null && { resumedFromRunId: m.resumedFromRunId }),
        ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
      }));
    },
    getWorkflowRun: (id: string, projectId?: ProjectId): WorkflowRunDetail | null => {
      const runStore = lookupRuntime(projectId).runStore;
      const m = runStore.getRun(id);
      if (!m) return null;
      return {
        id: m.id,
        workflow: m.workflow,
        status: m.status,
        triggerEvent: m.trigger.event,
        triggerSchemaRef: m.trigger.schemaRef,
        startedAt: m.startedAt,
        ...(m.completedAt != null && { completedAt: m.completedAt }),
        ...(m.durationMs != null && { durationMs: m.durationMs }),
        ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
        ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
        ...(m.causedBy != null && { causedBy: m.causedBy }),
        ...(m.retryOf != null && { retryOf: m.retryOf }),
        ...(m.resumedFromRunId != null && { resumedFromRunId: m.resumedFromRunId }),
        ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
        ...(m.trigger.payload && Object.keys(m.trigger.payload).length > 0 && { triggerPayload: m.trigger.payload }),
        ...(m.warnings && m.warnings.length > 0 && { warnings: m.warnings }),
        steps: m.steps.map((s) => {
          const agentCost = s.type === "agent" && typeof (s.output as { totalCostUsd?: unknown } | null | undefined)?.totalCostUsd === "number"
            ? (s.output as { totalCostUsd: number }).totalCostUsd
            : undefined;
          return {
            id: s.id,
            type: s.type,
            status: s.status,
            durationMs: s.durationMs,
            ...(s.error != null && { error: s.error }),
            ...(agentCost != null && { costUsd: agentCost }),
            ...(s.toolCalls != null && { toolCalls: s.toolCalls }),
            ...(s.skipReason != null && { skipReason: s.skipReason }),
          };
        }),
      };
    },
    getWorkflowMetricCounts: (projectId?: ProjectId): WorkflowMetricCounts => {
      const runtime = lookupRuntime(projectId);
      const cacheKey = runtime.project.projectId;
      const now = Date.now();
      const cached = metricCountsCache.get(cacheKey);
      if (cached && now - cached.at < 30_000) {
        return {
          ...cached.value,
          deadLetterCounts: runtime.deadLetterQueue.counts(runtime.project.projectId),
        };
      }
      const DURATION_BUCKETS_S = [30, 120, 300, 900, 1800, 3600] as const;
      const runs = runtime.runStore.listRuns({ limit: 100_000 });
      const countMap = new Map<string, number>();
      const costMap = new Map<string, number>();
      const durationMap = new Map<string, { buckets: Map<number | "+Inf", number>; sum: number; count: number }>();
      for (const run of runs) {
        if (!run.workflow || !run.status || run.status === "running") continue;
        const countKey = `${run.workflow}\x00${run.status}`;
        countMap.set(countKey, (countMap.get(countKey) ?? 0) + 1);
        if (typeof run.totalCostUsd === "number") {
          costMap.set(run.workflow, (costMap.get(run.workflow) ?? 0) + run.totalCostUsd);
        }
        if (typeof run.durationMs === "number") {
          const durationS = run.durationMs / 1000;
          let entry = durationMap.get(countKey);
          if (!entry) {
            const buckets = new Map<number | "+Inf", number>();
            for (const b of DURATION_BUCKETS_S) buckets.set(b, 0);
            buckets.set("+Inf", 0);
            entry = { buckets, sum: 0, count: 0 };
            durationMap.set(countKey, entry);
          }
          for (const b of DURATION_BUCKETS_S) {
            if (durationS <= b) entry.buckets.set(b, (entry.buckets.get(b) ?? 0) + 1);
          }
          entry.buckets.set("+Inf", (entry.buckets.get("+Inf") ?? 0) + 1);
          entry.sum += durationS;
          entry.count += 1;
        }
      }
      const runCounts: WorkflowRunCountEntry[] = [];
      for (const [key, count] of countMap) {
        const sep = key.indexOf("\x00");
        runCounts.push({ workflow: key.slice(0, sep), status: key.slice(sep + 1), count });
      }
      const costTotals: WorkflowCostEntry[] = [];
      for (const [workflow, costUsd] of costMap) {
        costTotals.push({ workflow, costUsd });
      }
      const durationHistogram: WorkflowDurationHistogramEntry[] = [];
      for (const [key, entry] of durationMap) {
        const sep = key.indexOf("\x00");
        durationHistogram.push({
          workflow: key.slice(0, sep),
          status: key.slice(sep + 1),
          buckets: [...entry.buckets.entries()].map(([le, count]) => ({ le, count })),
          sum: entry.sum,
          count: entry.count,
        });
      }
      const result: WorkflowMetricCounts = {
        runCounts,
        costTotals,
        durationHistogram,
        deadLetterCounts: runtime.deadLetterQueue.counts(runtime.project.projectId),
      };
      metricCountsCache.set(cacheKey, { value: result, at: now });
      return result;
    },
    listDeadLetters: (opts) => {
      const runtime = lookupRuntime(opts?.projectId);
      return {
        items: runtime.deadLetterQueue.list({
          status: opts?.status,
          type: opts?.type,
          workflowName: opts?.workflowName,
          limit: opts?.limit,
          scopeId: runtime.project.projectId,
        }),
        counts: runtime.deadLetterQueue.counts(runtime.project.projectId),
      };
    },
    getDeadLetter: (id: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).deadLetterQueue.get(id),
    dismissDeadLetter: (id: string, reason: string, projectId?: ProjectId) => {
      const item = lookupRuntime(projectId).deadLetterQueue.dismiss(id, reason);
      return item ? { ok: true, item } : { ok: false, reason: "not_found" };
    },
    redriveDeadLetter: (
      id: string,
      reason: string,
      target,
      projectId?: ProjectId,
    ) => {
      const runtime = lookupRuntime(projectId);
      const result = runtime.workflowRuntime.redriveDeadLetter(id, reason, target);
      const item = runtime.deadLetterQueue.get(id);
      if (!result.ok) return { ok: false, reason: result.reason ?? "not_found" };
      if (!item) return { ok: false, reason: "not_found" };
      return {
        ok: true,
        item,
        ...(result.runId !== undefined ? { runId: result.runId } : {}),
        ...(result.workflowName !== undefined ? { workflowName: result.workflowName } : {}),
        ...(result.event !== undefined ? { event: result.event } : {}),
      };
    },
    exportDeadLetterDiagnostics: (id: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).deadLetterQueue.diagnostics(id),
    registerSession: (
      id: string,
      createdAt: string,
      autonomyMode: AutonomyMode,
      projectId?: ProjectId,
    ) => {
      const resolvedProjectId = projectId ?? projectRegistry.getDefaultProjectId();
      sessions.set(id, {
        id,
        scopeId: resolvedProjectId,
        projectId: resolvedProjectId,
        createdAt,
        lastActive: Date.now(),
        autonomyMode,
        source: "serve",
      });
      lookupRuntime(resolvedProjectId).pbus.emit("session.registered", {
        id,
        createdAt,
        autonomyMode,
      });
    },
    unregisterSession: (id: string) => {
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      lookupRuntime(session.projectId).pbus.emit("session.unregistered", { id });
    },
    listSessions: (projectId?: ProjectId) => {
      return [...sessions.values()].filter(
        (session) => projectId === undefined || session.projectId === projectId,
      );
    },
    setSessionAutonomyMode: (id: string, mode: AutonomyMode) => {
      const session = sessions.get(id);
      if (!session) return { ok: false, notFound: true };
      session.autonomyMode = mode;
      // The typed `session.autonomy.changed` event is emitted from
      // AgentSession.setAutonomyMode when the mode actually changes. Serve-
      // registered sessions live in another process — this daemon copy is
      // metadata only. The daemon control server layers a setter for its own
      // chat pool on top; for serve-registered rows we report serveOwned so the
      // caller can forward the change or surface it to the operator.
      return { ok: true, serveOwned: session.source !== "daemon" };
    },
  };
}

function resolveInteractiveGuardrailsConfig(config: KotaConfig): GuardrailsConfig {
  return config.guardrails ?? getDefaultGuardrails();
}

function buildSessionGuardrailsReloadSummary(
  daemonSummary: { refreshed: number; unchanged: number },
  sessions: Map<string, InteractiveSession>,
): SessionGuardrailsReloadSummary {
  return {
    refreshed: daemonSummary.refreshed,
    unchanged: daemonSummary.unchanged,
    nonRefreshable: [...sessions.values()]
      .filter((session) => session.source !== "daemon")
      .map((session) => ({
        id: session.id,
        source: "serve" as const,
        reason: "serve-owned-session" as const,
      })),
  };
}
