import {
  type DeadLetterItem,
  deadLetterStoreForProject,
  deadLetterWorkflowName,
} from "#core/daemon/dead-letter-queue.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  emitHealth,
  stableToken,
  WORKFLOW_FAILURE_HEALTH_LABELS,
  workflowFailureHealthSource,
  workflowFailureIssueKey,
} from "./autonomy-issue-source-shared.js";
import { deadLetterHealthCategory } from "./dead-letter-health.js";

type DeadLetterSourceContext = Pick<ModuleRuntimeContext, "cwd" | "events">;

function deadLetterIssueKey(item: DeadLetterItem): string {
  const workflowName = deadLetterWorkflowName(item);
  if (item.type === "workflow-dispatch" && workflowName) {
    return workflowFailureIssueKey({
      workflowName,
      errorSummary: item.failure.reason,
      fallback: item.failure.lastErrorClass,
    });
  }
  const classification = deadLetterHealthCategory(item.failure);
  const workflowKey = workflowName ?? item.owningModule;
  return `dead-letter:${classification.failureClass}:` +
    `${stableToken(item.owningModule)}:${stableToken(workflowKey)}`;
}

export function subscribeDeadLetterChanges(ctx: DeadLetterSourceContext): void {
  ctx.events.subscribe("workflow.dead-letter.changed", (payload) => {
    const classification = deadLetterHealthCategory({
      lastErrorClass: payload.failureClass,
      reason: payload.failureReason,
    });
    const workflowFailureName = payload.type === "workflow-dispatch"
      ? payload.workflowName ?? undefined
      : undefined;
    const workflowKey = payload.workflowName ?? payload.owningModule;
    const dedupeKey = workflowFailureName !== undefined
      ? workflowFailureIssueKey({
        workflowName: workflowFailureName,
        errorSummary: payload.failureReason,
        fallback: payload.failureClass,
      })
      : `dead-letter:${classification.failureClass}:` +
        `${stableToken(payload.owningModule)}:${stableToken(workflowKey)}`;
    const matchingItems = deadLetterStoreForProject(ctx.cwd)
      .list()
      .filter((item) => deadLetterIssueKey(item) === dedupeKey);
    if (
      payload.status !== "open" &&
      matchingItems.some((item) => item.status === "open")
    ) {
      return;
    }
    emitHealth(ctx, payload.projectId, {
      observation: payload.status === "open" ? "present" : "cleared",
      source: workflowFailureName !== undefined
        ? workflowFailureHealthSource(workflowFailureName)
        : { kind: "dead-letter", id: payload.id },
      severity: workflowFailureName !== undefined ? "critical" : classification.severity,
      labels: workflowFailureName !== undefined
        ? WORKFLOW_FAILURE_HEALTH_LABELS
        : classification.labels,
      summary:
        `Dead-letter ${payload.id} is ${payload.status}; ` +
        (payload.resolutionReason
          ? `resolution: ${payload.resolutionReason}.`
          : `${classification.failureClass} evidence remains in the canonical queue record.`),
      evidenceRefs: matchingItems.map((item) => ({
        kind: "dead-letter" as const,
        ref: `.kota/dead-letter-queue/items.json#${item.id}`,
      })),
      actionability:
        workflowFailureName !== undefined
          ? "local-code"
          : classification.actionability,
      dedupeKey,
      observationCount: 1,
      createdAt: payload.updatedAt,
    });
  });
}
