import type {
  WorkflowCompletion,
  WorkflowRuntimeState,
} from "#core/workflow/run-types.js";
import type { DaemonRuntimeContext } from "./daemon-runtime-context.js";

export function buildDaemonDashboardSnapshot(ctx: DaemonRuntimeContext) {
  const workflows = ctx.projectRuntimes.getDefault().workflowRuntime;
  const state = workflows.getState();
  const dispatchWindow = workflows.getDispatchWindowStatus();
  const dispatchPause = workflows.getDispatchPauseStatus();
  const lastCompletion = latestWorkflowCompletion(state.workflows);
  return {
    pid: ctx.state.pid,
    startedAt: ctx.state.startedAt,
    running: ctx.running,
    stopping: ctx.stopping,
    completedRuns: state.completedRuns,
    totalCostUsd: state.totalCostUsd,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    ...(lastCompletion !== undefined
      ? {
          lastCompletedWorkflow: lastCompletion.workflow,
          lastCompletedAt: lastCompletion.completedAt,
          lastCompletedStatus: lastCompletion.status,
        }
      : {}),
    activeRuns: state.activeRuns,
    pendingRuns: state.pendingRuns,
    dispatchPaused: dispatchPause.paused,
    dispatchPause,
    dispatchWindowBlocked: dispatchWindow.blocked,
    dispatchWindowOpensAt: dispatchWindow.opensAt,
    agentBackoff: state.agentBackoff,
    definitionCount: workflows.getDefinitionCount(),
    sessionCount: ctx.sessions.size,
  };
}

function latestWorkflowCompletion(
  workflows: WorkflowRuntimeState["workflows"],
): (WorkflowCompletion & { workflow: string }) | undefined {
  let latest: (WorkflowCompletion & { workflow: string }) | undefined;
  for (const [workflow, state] of Object.entries(workflows)) {
    const completion = state.lastCompletion;
    if (
      completion !== undefined &&
      (latest === undefined ||
        completion.completedAt > latest.completedAt ||
        (completion.completedAt === latest.completedAt && completion.runId > latest.runId))
    ) {
      latest = { workflow, ...completion };
    }
  }
  return latest;
}
