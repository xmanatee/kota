import type { WorkflowEnqueueOptions } from "#core/workflow/operator-trigger.js";
import { buildClientIdentity, type ClientIdentity } from "./client-identity.js";
import type {
  DaemonControlHandle,
  WorkflowDefinitionSummary,
} from "./daemon-control-types.js";
import type { DaemonHandleContext } from "./daemon-handle.js";
import type { ProjectRuntime } from "./project-runtime.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import type { ProjectId } from "./scope-registry.js";

type WorkflowHandle = Pick<
  DaemonControlHandle,
  | "getWorkflowLiveStatus"
  | "pauseWorkflowDispatch"
  | "resumeWorkflowDispatch"
  | "probeCapabilityReadiness"
  | "getClientIdentity"
  | "abortActiveRuns"
  | "abortActiveRun"
  | "reloadWorkflowDefinitions"
  | "getWorkflowDefinitions"
  | "enableWorkflow"
  | "disableWorkflow"
  | "enqueuePendingRun"
  | "cancelQueuedRun"
>;

export function buildDaemonWorkflowHandle(
  ctx: DaemonHandleContext,
  lookupRuntime: (projectId?: ProjectId) => ProjectRuntime,
  getUnavailableScopeState: (
    projectId: ProjectId,
  ) => Exclude<ScopeHostingState, "hosted"> | null,
): WorkflowHandle {
  const { projectRegistry } = ctx;
  return {
    getWorkflowLiveStatus: (projectId?: ProjectId) => {
      const workflows = lookupRuntime(projectId).workflowRuntime;
      const wfState = workflows.getState();
      const windowStatus = workflows.getDispatchWindowStatus();
      const recovery = workflows.getRecoveryStatus();
      const pause = workflows.getDispatchPauseStatus(recovery);
      return {
        activeRuns: wfState.activeRuns ?? [],
        pendingRuns: wfState.pendingRuns,
        queueLength: wfState.queueLength,
        completedRuns: wfState.completedRuns,
        totalCostUsd: wfState.totalCostUsd,
        totalInputTokens: wfState.totalInputTokens,
        totalOutputTokens: wfState.totalOutputTokens,
        agentBackoff: wfState.agentBackoff,
        definitionsLoadedAt: wfState.definitionsLoadedAt,
        workflows: wfState.workflows,
        paused: workflows.isDispatchPaused(),
        pause,
        recovery,
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
      const recovery = workflows.getRecoveryStatus();
      const pause = workflows.getDispatchPauseStatus(recovery);
      if (pause.kind === "dirty-recovery") {
        return {
          already: true,
          blocked: "dirty-recovery" as const,
          message: pause.nextAction,
        };
      }
      const already = !workflows.isDispatchPaused();
      if (!already) workflows.setDispatchPaused(false, "persistent");
      return { already };
    },
    probeCapabilityReadiness: () => ctx.probeCapabilityReadiness(),
    getClientIdentity: async (): Promise<ClientIdentity> => {
      const capabilities = await ctx.probeCapabilityReadiness();
      const state = ctx.getState();
      return buildClientIdentity({
        projectDir: projectRegistry.getDefault().projectDir,
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
          triggers: def.triggers.map((trigger): WorkflowDefinitionSummary["triggers"][number] => {
            if (trigger.webhook) return { type: "webhook" };
            if (trigger.watch) {
              return {
                type: "watch",
                patterns: trigger.watch,
                debounceMs: trigger.debounceMs ?? 500,
              };
            }
            if (trigger.schedule) return { type: "cron", schedule: trigger.schedule };
            if (trigger.intervalMs != null) {
              return { type: "interval", intervalMs: trigger.intervalMs };
            }
            return {
              type: "event",
              event: trigger.event,
              ...(trigger.filter
                ? { filter: trigger.filter as Record<string, string | string[]> }
                : {}),
            };
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
      options?: WorkflowEnqueueOptions,
      projectId?: ProjectId,
    ) => {
      const resolvedProjectId = projectId ?? projectRegistry.getDefaultProjectId();
      const state = getUnavailableScopeState(resolvedProjectId);
      if (state !== null) {
        return {
          ok: false,
          error: `Scope ${resolvedProjectId} is ${state} and cannot accept workflow runs`,
          reason: "scope_not_hosted" as const,
          scopeId: resolvedProjectId,
          state,
        };
      }
      return lookupRuntime(resolvedProjectId).workflowRuntime.enqueuePendingRun(
        name,
        options,
      );
    },
    cancelQueuedRun: (runId: string, projectId?: ProjectId) =>
      lookupRuntime(projectId).workflowRuntime.cancelQueuedRun(runId),
  };
}
