import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { StateValueConflictError } from "#core/workflow/run-state-database.js";
import { canRestartRetainedWorkflow } from "#core/workflow/run-state-types.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  autonomyIssueDecisionRequested,
  autonomyIssueReconciliationRequested,
} from "./autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import {
  planAutonomyIssueOwnerReconciliation,
  publishExhaustedInvestigationAttention,
} from "./autonomy-issue-reconciliation.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";

type ReconciliationSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider" | "log"
>;

async function reconcile(
  ctx: ReconciliationSourceContext,
  payload: { scopeId: string; requestedAt: string },
): Promise<void> {
  const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
  // The owning runtime assesses relevance and reconciles its own suspended
  // contract atomically. Rejection is intentional retention, not a new task.
  for (const run of runtime.runState.listRuns(runtime.scopeId)) {
    if (run.workflow === "builder" && run.state === "needs_attention" && canRestartRetainedWorkflow(run)) {
      await runtime.workflowRuntime.enqueuePendingRun(run.workflow, { payload: { retryOf: run.id } });
    }
  }
  const snapshot = runtime.runState.readScopeStateValue<AutonomyIssueProjection>(
    runtime.scopeId,
    AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  );
  const currentProjection = decodeAutonomyIssueProjection(snapshot.value);
  const runs = runtime.runState.listRuns(runtime.scopeId);
  const tasks = listFullRepoTasks(runtime.workspaceRoot);
  const questions = runtime.ownerQuestionQueue.list();
  const projection = publishExhaustedInvestigationAttention({
    projection: currentProjection,
    runs,
    tasks,
    questions,
    requestedAt: payload.requestedAt,
  });
  if (projection !== currentProjection) {
    try {
      runtime.runState.compareAndSetScopeStateValue({
        scopeId: runtime.scopeId,
        key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        expectedRevision: snapshot.revision,
        value: projection,
        updatedAt: payload.requestedAt,
      });
    } catch (error) {
      if (error instanceof StateValueConflictError) return;
      throw error;
    }
  }
  const requests = planAutonomyIssueOwnerReconciliation({
    projection,
    runs,
    tasks,
    questions,
    requestedAt: payload.requestedAt,
  });
  for (const { phase: _phase, notBeforeAt, ...request } of requests) {
    if (notBeforeAt === undefined) {
      ctx.events.emit(autonomyIssueDecisionRequested, {
        scopeId: runtime.scopeId,
        ...request,
      });
      continue;
    }
    const admission = await runtime.workflowRuntime.enqueuePendingRun("improver", {
      event: autonomyIssueDecisionRequested.name,
      payload: { scopeId: runtime.scopeId, ...request },
      runId: formatRunId("improver"),
      notBeforeMs: Date.parse(notBeforeAt),
    });
    if (!admission.ok) {
      throw new Error(
        `Could not queue durable investigation retry for ${request.issueKey}: ` +
          (admission.error ?? "workflow admission failed"),
      );
    }
  }
}

export function subscribeAutonomyIssueReconciliation(
  ctx: ReconciliationSourceContext,
): void {
  const observe = (payload: { scopeId: string; requestedAt: string }): void => {
    void reconcile(ctx, payload).catch((error: unknown) => {
      ctx.log.error(`Autonomy issue reconciliation failed for ${payload.scopeId}`, error);
    });
  };
  ctx.events.subscribe(autonomyIssueReconciliationRequested, (payload) => {
    observe(payload);
  });
  ctx.events.subscribe("workflow.completed", (payload) => {
    observe({
      scopeId: payload.scopeId,
      requestedAt: new Date().toISOString(),
    });
  });
  ctx.events.subscribe("workflow.run.reconciliation-needed", (payload) => {
    observe({
      scopeId: payload.scopeId,
      requestedAt: payload.transitionedAt,
    });
  });
  ctx.events.subscribe("owner.decision.resolved", (payload) => {
    observe({
      scopeId: payload.scopeId,
      requestedAt: new Date().toISOString(),
    });
  });
}
