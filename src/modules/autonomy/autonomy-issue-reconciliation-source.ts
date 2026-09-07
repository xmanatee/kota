import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { StateValueConflictError } from "#core/workflow/run-state-database.js";
import { formatRunId } from "#core/workflow/run-io.js";
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
  autonomyIssueProjectionMaterializationRequested,
} from "./autonomy-issue-projection-publication.js";
import {
  planAutonomyIssueOwnerReconciliation,
  publishExhaustedInvestigationAttention,
} from "./autonomy-issue-reconciliation.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";

type ReconciliationSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

function reconcile(
  ctx: ReconciliationSourceContext,
  payload: { scopeId: string; requestedAt: string },
): void {
  const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
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
    ctx.events.emit(autonomyIssueProjectionMaterializationRequested, {
      scopeId: runtime.scopeId,
      idempotencyKey: `autonomy-issue-projection:${snapshot.revision + 1}`,
      stateRevision: snapshot.revision + 1,
    });
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
    const admission = runtime.workflowRuntime.enqueuePendingRun("improver", {
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
  ctx.events.subscribe(autonomyIssueReconciliationRequested, (payload) => {
    reconcile(ctx, payload);
  });
  ctx.events.subscribe("workflow.completed", (payload) => {
    reconcile(ctx, {
      scopeId: payload.scopeId,
      requestedAt: new Date().toISOString(),
    });
  });
  ctx.events.subscribe("workflow.run.reconciliation-needed", (payload) => {
    reconcile(ctx, {
      scopeId: payload.scopeId,
      requestedAt: payload.transitionedAt,
    });
  });
  ctx.events.subscribe("owner.decision.resolved", (payload) => {
    reconcile(ctx, {
      scopeId: payload.scopeId,
      requestedAt: new Date().toISOString(),
    });
  });
}
