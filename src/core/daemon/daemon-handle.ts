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
  SetActiveProjectResult,
} from "./daemon-control-types.js";
import { buildDaemonConfigReloadHandle } from "./daemon-handle-config-reload.js";
import { buildDaemonRunHandle } from "./daemon-handle-runs.js";
import { buildDaemonWorkflowHandle } from "./daemon-handle-workflows.js";
import type { DaemonState } from "./daemon-state.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
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
  scopeAuthority?: ScopeAuthorityService;
  scopeAuthorityOperatorVerifier?: ScopeAuthorityOperatorTokenVerifier;
  projectRuntimes: ProjectRuntimeRegistry;
  getScopeHostingState: (scopeId: ProjectId) => ScopeHostingState;
  config: DaemonConfig;
  refreshLiveSessionGuardrails: (config: GuardrailsConfig) => {
    refreshed: number;
    unchanged: number;
  };
  log: (message: string) => void;
  getModuleSummaries: () => readonly ModuleSummary[];
  getModuleHealthChecks: () => Record<string, ModuleHealthCheckResult>;
  probeCapabilityReadiness: () => Promise<CapabilityReadinessResponse>;
  getChannelStatuses: () => readonly ChannelStatus[];
};

export function buildDaemonHandle(ctx: DaemonHandleContext): DaemonControlHandle {
  const { sessions, projectDir, projectRegistry, projectRuntimes, config, bus } = ctx;
  const setupService = new ModuleSetupService({
    projectDir,
    ...(config.authorityConfigPath !== undefined
      ? { authorityConfigPath: config.authorityConfigPath }
      : {}),
    getRequirements: () => moduleSetupRequirementsFromSummaries(ctx.getModuleSummaries()),
    probeCapabilities: async () => (await ctx.probeCapabilityReadiness()).capabilities,
    getVisibility: () => {
      const runtime = projectRuntimes.getDefault();
      if (!runtime.scopePolicyAuthority) {
        throw new Error("Scope policy authority is unavailable for the default runtime");
      }
      return runtime.scopePolicyAuthority.getSnapshot(runtime.project.projectId).policy.setup
        .visibility;
    },
  });
  let activeProjectId: ProjectId | null = null;
  const lookupRuntime = (projectId?: ProjectId): ProjectRuntime =>
    projectId === undefined ? projectRuntimes.getDefault() : projectRuntimes.get(projectId);
  const getUnavailableScopeState = (
    projectId: ProjectId,
  ): Exclude<ScopeHostingState, "hosted"> | null => {
    const state = ctx.getScopeHostingState(projectId);
    return state === "hosted" ? null : state;
  };

  return {
    getHealthStatus: () => {
      const checks = ctx.getModuleHealthChecks();
      const hasUnhealthy = Object.values(checks).some((check) => check.status === "unhealthy");
      return {
        scheduler: "ok" as const,
        modules: hasUnhealthy ? ("error" as const) : ("ok" as const),
        ...(Object.keys(checks).length > 0 ? { moduleHealthChecks: checks } : {}),
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
    completeModuleSetup: (actionId, input) => setupService.complete(actionId, input),
    refreshModuleSetup: (moduleName, requirementId) =>
      setupService.refresh(moduleName, requirementId),
    revokeModuleSetup: (moduleName, requirementId) =>
      setupService.revoke(moduleName, requirementId),
    getProjectRegistryProjection: (): ProjectRegistryProjection => projectRegistry.toProjection(),
    getScopeRegistryProjection: (): ScopeRegistryProjection => projectRegistry.toScopeProjection(),
    getScopeHostingState: (scopeId: ProjectId) => ctx.getScopeHostingState(scopeId),
    hasScope: (scopeId: string) =>
      projectRegistry.toScopeProjection().scopes.some((scope) => scope.scopeId === scopeId),
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
    hasProject: (projectId: string) =>
      projectRegistry.get(projectId) !== undefined
      && getUnavailableScopeState(projectId) === null,
    getActiveProjectId: (): ProjectId | null => {
      if (
        activeProjectId !== null
        && (
          projectRegistry.get(activeProjectId) === undefined
          || getUnavailableScopeState(activeProjectId) !== null
        )
      ) {
        activeProjectId = null;
      }
      return activeProjectId;
    },
    setActiveProjectId: (next: ProjectId | null): SetActiveProjectResult => {
      if (next === null) {
        activeProjectId = null;
        return { ok: true, activeProjectId: null };
      }
      if (projectRegistry.get(next) === undefined) {
        return { ok: false, reason: "not_found", projectId: next };
      }
      const state = getUnavailableScopeState(next);
      if (state !== null) return { ok: false, reason: "not_hosted", projectId: next, state };
      activeProjectId = next;
      return { ok: true, activeProjectId: next };
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
    redriveDeadLetter: (id, reason, target, projectId) => {
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
    registerSession: (id, createdAt, autonomyMode, projectId) => {
      const resolvedProjectId = projectId ?? projectRegistry.getDefaultProjectId();
      const state = getUnavailableScopeState(resolvedProjectId);
      if (state !== null) {
        return {
          ok: false,
          reason: "scope_not_hosted",
          scopeId: resolvedProjectId,
          state,
        };
      }
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
      return { ok: true, scopeId: resolvedProjectId };
    },
    unregisterSession: (id: string) => {
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      lookupRuntime(session.projectId).pbus.emit("session.unregistered", { id });
    },
    listSessions: (projectId?: ProjectId) => [...sessions.values()].filter(
      (session) => projectId === undefined || session.projectId === projectId,
    ),
    setSessionAutonomyMode: (id: string, mode: AutonomyMode) => {
      const session = sessions.get(id);
      if (!session) return { ok: false, notFound: true };
      session.autonomyMode = mode;
      return { ok: true, serveOwned: session.source !== "daemon" };
    },
  };
}
