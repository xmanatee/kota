import type { ChannelStatus } from "#core/channels/channel.js";
import type { EventBus } from "#core/events/event-bus.js";
import { moduleSetupRequirementsFromSummaries } from "#core/modules/module-setup-status.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import { ModuleSetupService } from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";
import type { DaemonConfig } from "./daemon.js";
import type {
  DaemonControlHandle,
  InteractiveSession,
  ModuleHealthCheckResult,
  SetActiveScopeResult,
} from "./daemon-control-types.js";
import { buildDaemonConfigReloadHandle } from "./daemon-handle-config-reload.js";
import { buildDaemonRunHandle } from "./daemon-handle-runs.js";
import { buildDaemonWorkflowHandle } from "./daemon-handle-workflows.js";
import { buildDaemonHealthStatus } from "./daemon-health.js";
import type { DaemonState } from "./daemon-state.js";
import type { EventLoopLatencySnapshot } from "./event-loop-latency.js";
import type { LifecycleCollector } from "./lifecycle-collector.js";
import type {
  ScopeAuthorityOperatorAction,
  ScopeAuthorityOperatorRequest,
  ScopeAuthorityOperatorTokenVerifier,
} from "./scope-authority-operator-token.js";
import type { ScopeAuthorityService } from "./scope-authority-service.js";
import type { ScopeAuthorityMutation } from "./scope-authority-types.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import {
  defaultScopePolicyDecisionExamples,
  type ScopePolicyRouteResponse,
} from "./scope-policy.js";
import type {
  ScopeId,
  ScopeRegistry,
  ScopeRegistryProjection,
} from "./scope-registry.js";
import type { ScopeRuntime, ScopeRuntimeRegistry } from "./scope-runtime.js";

export type DaemonHandleContext = {
  getState: () => DaemonState;
  isRunning: () => boolean;
  workflows: WorkflowRuntime;
  bus: EventBus;
  sessions: Map<string, InteractiveSession>;
  runStore: WorkflowRunStore;
  scopeRoot: string;
  scopeRegistry: ScopeRegistry;
  scopeAuthority?: ScopeAuthorityService;
  scopeAuthorityOperatorVerifier?: ScopeAuthorityOperatorTokenVerifier;
  scopeRuntimes: ScopeRuntimeRegistry;
  getScopeHostingState: (scopeId: ScopeId) => ScopeHostingState;
  config: DaemonConfig;
  refreshLiveSessionGuardrails: (config: GuardrailsConfig) => {
    refreshed: number;
    unchanged: number;
  };
  log: (message: string) => void;
  getModuleSummaries: () => readonly ModuleSummary[];
  getModuleHealthChecks: () => Record<string, ModuleHealthCheckResult>;
  getEventLoopLatency?: () => EventLoopLatencySnapshot;
  probeCapabilityReadiness: () => Promise<CapabilityReadinessResponse>;
  getChannelStatuses: () => readonly ChannelStatus[];
  collector?: LifecycleCollector;
};

export function buildDaemonHandle(ctx: DaemonHandleContext): DaemonControlHandle {
  const { sessions, scopeRoot, scopeRegistry, scopeRuntimes, config, bus } = ctx;
  const setupService = new ModuleSetupService({
    scopeRoot,
    ...(config.authorityConfigPath !== undefined
      ? { authorityConfigPath: config.authorityConfigPath }
      : {}),
    getRequirements: () => moduleSetupRequirementsFromSummaries(ctx.getModuleSummaries()),
    probeCapabilities: async () => (await ctx.probeCapabilityReadiness()).capabilities,
    getVisibility: () => {
      const runtime = scopeRuntimes.getDefault();
      if (!runtime.scopePolicyAuthority) {
        throw new Error("Scope policy authority is unavailable for the default runtime");
      }
      return runtime.scopePolicyAuthority.getSnapshot(runtime.scope.scopeId).policy.setup
        .visibility;
    },
  });
  let activeScopeId: ScopeId | null = null;
  const lookupRuntime = (scopeId?: ScopeId): ScopeRuntime =>
    scopeId === undefined ? scopeRuntimes.getDefault() : scopeRuntimes.get(scopeId);
  const getUnavailableScopeState = (
    scopeId: ScopeId,
  ): Exclude<ScopeHostingState, "hosted"> | null => {
    const state = ctx.getScopeHostingState(scopeId);
    return state === "hosted" ? null : state;
  };

  return {
    getHealthStatus: () => buildDaemonHealthStatus(
      ctx.getModuleHealthChecks(),
      ctx.getEventLoopLatency?.(),
    ),
    getDaemonLiveState: () => ({ ...ctx.getState(), running: ctx.isRunning() }),
    listChannelStatuses: () => [...ctx.getChannelStatuses()],
    listModuleSetupStatuses: () => setupService.list(),
    submitModuleSetupForm: (moduleName, requirementId, values) =>
      setupService.submitForm(moduleName, requirementId, values),
    storeModuleSetupSecret: (moduleName, requirementId, secretValues) =>
      setupService.storeSecret(moduleName, requirementId, secretValues),
    startModuleSetup: (moduleName, requirementId) =>
      setupService.start(moduleName, requirementId),
    completeModuleSetup: (actionId, input) => setupService.complete(actionId, input),
    refreshModuleSetup: (moduleName, requirementId) =>
      setupService.refresh(moduleName, requirementId),
    revokeModuleSetup: (moduleName, requirementId) =>
      setupService.revoke(moduleName, requirementId),
    getScopeRegistryProjection: (): ScopeRegistryProjection => scopeRegistry.toProjection(),
    getScopeHostingState: (scopeId: ScopeId) => ctx.getScopeHostingState(scopeId),
    getScopePolicy: (scopeId: string): ScopePolicyRouteResponse => {
      if (!ctx.scopeAuthority) throw new Error("Scope policy authority is unavailable");
      const snapshot = ctx.scopeAuthority.getSnapshot(scopeId);
      return {
        ...snapshot,
        decisionExamples: defaultScopePolicyDecisionExamples(snapshot.policy),
      };
    },
    ...(ctx.scopeAuthority ? {
      inspectScopeAuthority: (scopeId: string) => ctx.scopeAuthority!.inspect(scopeId),
      validateScopeAuthority: (scopeId: string, mutation: ScopeAuthorityMutation) =>
        ctx.scopeAuthority!.validate(scopeId, mutation),
      applyScopeAuthority: (
        scopeId: string,
        mutation: ScopeAuthorityMutation,
        operatorAction?: ScopeAuthorityOperatorAction,
      ) => ctx.scopeAuthority!.apply(scopeId, mutation, operatorAction),
      answerScopeAuthorityOperatorChallenge: (challenge: string) =>
        ctx.scopeAuthorityOperatorVerifier?.answerChallenge(challenge),
      authorizeScopeAuthorityAction: (
        request: ScopeAuthorityOperatorRequest,
        suppliedProof: string | undefined,
      ) => ctx.scopeAuthorityOperatorVerifier?.authorize(request, suppliedProof),
    } : {}),
    hasScope: (scopeId: string) =>
      scopeRegistry.get(scopeId) !== undefined
      && getUnavailableScopeState(scopeId) === null,
    getActiveScopeId: (): ScopeId | null => {
      if (
        activeScopeId !== null
        && (
          scopeRegistry.get(activeScopeId) === undefined
          || getUnavailableScopeState(activeScopeId) !== null
        )
      ) {
        activeScopeId = null;
      }
      return activeScopeId;
    },
    setActiveScopeId: (next: ScopeId | null): SetActiveScopeResult => {
      if (next === null) {
        activeScopeId = null;
        return { ok: true, activeScopeId: null };
      }
      if (scopeRegistry.get(next) === undefined) {
        return { ok: false, reason: "not_found", scopeId: next };
      }
      const state = getUnavailableScopeState(next);
      if (state !== null) return { ok: false, reason: "not_hosted", scopeId: next, state };
      activeScopeId = next;
      return { ok: true, activeScopeId: next };
    },
    ...buildDaemonWorkflowHandle(ctx, lookupRuntime, getUnavailableScopeState),
    ...buildDaemonConfigReloadHandle(ctx),
    subscribeToEvents: (handler) => {
      const stops = [
        bus.on("workflow.started", (payload) => {
          handler({ type: "workflow.started", payload });
          handler({
            type: "queue.changed",
            payload: { source: "workflow.started", workflow: payload.workflow },
          });
        }),
        bus.on("workflow.completed", (payload) => {
          handler({ type: "workflow.completed", payload });
          handler({
            type: "queue.changed",
            payload: {
              source: "workflow.completed",
              workflow: payload.workflow,
              status: payload.status,
            },
          });
        }),
        bus.on("workflow.step.completed", (payload) =>
          handler({ type: "workflow.step.completed", payload })),
        bus.on("daemon.config.reload", (payload) =>
          handler({ type: "daemon.config.reload", payload })),
        bus.on("scope.lifecycle.changed", (payload) =>
          handler({ type: "scope.lifecycle.changed", payload })),
        bus.on("approval.changed", (payload) => handler({ type: "approval.changed", payload })),
        bus.on("task.changed", (payload) => handler({ type: "task.changed", payload })),
        bus.on("session.registered", (payload) =>
          handler({ type: "session.registered", payload })),
        bus.on("session.unregistered", (payload) =>
          handler({ type: "session.unregistered", payload })),
        bus.on("owner.question.asked", (payload) =>
          handler({ type: "owner.question.asked", payload })),
        bus.on("owner.question.changed", (payload) =>
          handler({ type: "owner.question.changed", payload })),
        bus.on("owner.question.resolved", (payload) =>
          handler({ type: "owner.question.resolved", payload })),
        bus.on("owner.question.dismissed", (payload) =>
          handler({ type: "owner.question.dismissed", payload })),
        bus.on("owner.question.expired", (payload) =>
          handler({ type: "owner.question.expired", payload })),
      ];
      return () => stops.forEach((stop) => stop());
    },
    ...buildDaemonRunHandle(lookupRuntime),
    listDeadLetters: (opts) => {
      const runtime = lookupRuntime(opts?.scopeId);
      return {
        items: runtime.deadLetterQueue.list({
          status: opts?.status,
          type: opts?.type,
          workflowName: opts?.workflowName,
          limit: opts?.limit,
          scopeId: runtime.scope.scopeId,
        }),
        counts: runtime.deadLetterQueue.counts(runtime.scope.scopeId),
      };
    },
    getDeadLetter: (id: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).deadLetterQueue.get(id),
    dismissDeadLetter: (id: string, reason: string, scopeId?: ScopeId) => {
      const item = lookupRuntime(scopeId).deadLetterQueue.dismiss(id, reason);
      return item ? { ok: true, item } : { ok: false, reason: "not_found" };
    },
    redriveDeadLetter: (id, reason, target, scopeId) => {
      const runtime = lookupRuntime(scopeId);
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
    exportDeadLetterDiagnostics: (id: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).deadLetterQueue.diagnostics(id),
    registerSession: (id, createdAt, autonomyMode, scopeId) => {
      const resolvedScopeId = scopeId ?? scopeRegistry.getDefaultScopeId();
      const state = getUnavailableScopeState(resolvedScopeId);
      if (state !== null) {
        return {
          ok: false,
          reason: "scope_not_hosted",
          scopeId: resolvedScopeId,
          state,
        };
      }
      sessions.set(id, {
        id,
        scopeId: resolvedScopeId,
        createdAt,
        lastActive: Date.now(),
        autonomyMode,
        source: "serve",
      });
      lookupRuntime(resolvedScopeId).pbus.emit("session.registered", {
        id,
        createdAt,
        autonomyMode,
      });
      return { ok: true, scopeId: resolvedScopeId };
    },
    unregisterSession: (id: string) => {
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      lookupRuntime(session.scopeId).pbus.emit("session.unregistered", { id });
    },
    listSessions: (scopeId?: ScopeId) => [...sessions.values()].filter(
      (session) => scopeId === undefined || session.scopeId === scopeId,
    ),
    setSessionAutonomyMode: (id: string, mode: AutonomyMode) => {
      const session = sessions.get(id);
      if (!session) return { ok: false, notFound: true };
      session.autonomyMode = mode;
      return { ok: true, serveOwned: session.source !== "daemon" };
    },
    getLifecycleStatus: (options) =>
      ctx.collector
        ? ctx.collector.status(options)
        : Promise.reject(new Error("Lifecycle collector is unavailable")),
    runLifecycleSweep: (options) =>
      ctx.collector
        ? ctx.collector.sweep(options)
        : Promise.reject(new Error("Lifecycle collector is unavailable")),
  };
}
