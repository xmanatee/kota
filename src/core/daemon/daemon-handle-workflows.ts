import type { WorkflowEnqueueOptions } from "#core/workflow/operator-trigger.js";
import { buildClientIdentity, type ClientIdentity } from "./client-identity.js";
import type {
  DaemonControlHandle,
  WorkflowDefinitionSummary,
} from "./daemon-control-types.js";
import type { DaemonHandleContext } from "./daemon-handle.js";
import type { ScopeHostingState } from "./scope-lifecycle-types.js";
import type { ScopeId } from "./scope-registry.js";
import type { ScopeRuntime } from "./scope-runtime.js";

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
  lookupRuntime: (scopeId?: ScopeId) => ScopeRuntime,
  getUnavailableScopeState: (
    scopeId: ScopeId,
  ) => Exclude<ScopeHostingState, "hosted"> | null,
): WorkflowHandle {
  const { scopeRegistry } = ctx;
  return {
    getWorkflowLiveStatus: (scopeId?: ScopeId) => {
      const workflows = lookupRuntime(scopeId).workflowRuntime;
      const wfState = workflows.getState();
      const windowStatus = workflows.getDispatchWindowStatus();
      const pause = workflows.getDispatchPauseStatus();
      return {
        activeRuns: wfState.activeRuns,
        pendingRuns: wfState.pendingRuns,
        queueLength: wfState.queueLength,
        completedRuns: wfState.completedRuns,
        agentBackoff: wfState.agentBackoff,
        definitionsLoadedAt: wfState.definitionsLoadedAt,
        workflows: wfState.workflows,
        paused: workflows.isDispatchPaused(),
        pause,
        concurrency: wfState.concurrency,
        ...(windowStatus.blocked && {
          dispatchWindowBlocked: true,
          dispatchWindowOpensAt: windowStatus.opensAt,
        }),
      };
    },
    pauseWorkflowDispatch: (scopeId?: ScopeId) => {
      const workflows = lookupRuntime(scopeId).workflowRuntime;
      const already = workflows.getDispatchPauseStatus().kind === "operator";
      if (!already) workflows.setDispatchPaused(true, "persistent");
      return { already };
    },
    resumeWorkflowDispatch: (scopeId, options) => {
      const workflows = lookupRuntime(scopeId).workflowRuntime;
      const already = !workflows.isDispatchPaused();
      const agentBackoffCleared = options?.retryAgent === true &&
        workflows.clearAgentBackoff("after explicit operator retry");
      if (!already) workflows.setDispatchPaused(false, "persistent");
      return {
        already,
        ...(agentBackoffCleared && { agentBackoffCleared: true as const }),
      };
    },
    probeCapabilityReadiness: () => ctx.probeCapabilityReadiness(),
    getClientIdentity: async (): Promise<ClientIdentity> => {
      const capabilities = await ctx.probeCapabilityReadiness();
      const state = ctx.getState();
      return buildClientIdentity({
        scopeRoot: scopeRegistry.getDefault().scopeRoot,
        pid: state.pid,
        startedAt: state.startedAt,
        capabilities,
        scopeRegistry: scopeRegistry.toProjection(),
      });
    },
    abortActiveRuns: (scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.abortActiveRuns(),
    abortActiveRun: (runId: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.abortActiveRun(runId),
    reloadWorkflowDefinitions: (scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.reloadWorkflowDefinitions(),
    getWorkflowDefinitions: (scopeId?: ScopeId): WorkflowDefinitionSummary[] => {
      const workflows = lookupRuntime(scopeId).workflowRuntime;
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
    enableWorkflow: (name: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.enableWorkflow(name),
    disableWorkflow: (name: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.disableWorkflow(name),
    enqueuePendingRun: (
      name: string,
      options?: WorkflowEnqueueOptions,
      scopeId?: ScopeId,
    ) => {
      const resolvedScopeId = scopeId ?? scopeRegistry.getDefaultScopeId();
      const state = getUnavailableScopeState(resolvedScopeId);
      if (state !== null) {
        return {
          ok: false,
          error: `Scope ${resolvedScopeId} is ${state} and cannot accept workflow runs`,
          reason: "scope_not_hosted" as const,
          scopeId: resolvedScopeId,
          state,
        };
      }
      return lookupRuntime(resolvedScopeId).workflowRuntime.enqueuePendingRun(
        name,
        options,
      );
    },
    cancelQueuedRun: (runId: string, scopeId?: ScopeId) =>
      lookupRuntime(scopeId).workflowRuntime.cancelQueuedRun(runId),
  };
}
