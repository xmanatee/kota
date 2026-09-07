import {
  type DeadLetterItem,
  deadLetterWorkflowName,
} from "#core/daemon/dead-letter-queue.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";
import {
  emitHealth,
  stableToken,
  workflowFailureHealthShape,
  workflowFailureHealthSource,
  workflowFailureIssueKey,
} from "./autonomy-issue-source-shared.js";
import { workflowHealthContractLabel } from "./autonomy-issue-workflow-source.js";
import { deadLetterHealthCategory } from "./dead-letter-health.js";

type DeadLetterSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

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
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
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
    const matchingItems = runtime.deadLetterQueue
      .list()
      .filter((item) => deadLetterIssueKey(item) === dedupeKey);
    const changedItem = matchingItems.find((item) => item.id === payload.id);
    const failedRun = changedItem?.source.kind === "workflow-dispatch" &&
        changedItem.source.failedRunId !== undefined
      ? runtime.runState.getRun(changedItem.source.failedRunId)
      : null;
    const workflowShape = workflowFailureName === undefined
      ? null
      : workflowFailureHealthShape({
          failureKind: payload.failureClass,
          triggerEvent: failedRun?.trigger.event ??
            (changedItem?.source.kind === "workflow-dispatch"
              ? changedItem.source.triggerEvent
              : "unattributed"),
          contractLabels: [
            failedRun === null
              ? "contract/unattributed"
              : workflowHealthContractLabel(failedRun),
          ],
        });
    if (
      payload.status !== "open" &&
      matchingItems.some((item) => item.status === "open")
    ) {
      return;
    }
    emitHealth(ctx, runtime.scopeId, {
      observation: payload.status === "open" ? "present" : "cleared",
      source: workflowFailureName !== undefined
        ? workflowFailureHealthSource(workflowFailureName)
        : { kind: "dead-letter", id: payload.id },
      severity: workflowShape?.severity ?? classification.severity,
      labels: workflowShape?.labels ?? classification.labels,
      summary:
        `Dead-letter ${payload.id} is ${payload.status}; ` +
        (payload.resolutionReason
          ? `resolution: ${payload.resolutionReason}.`
          : `${classification.failureClass} evidence remains in the canonical queue record.`),
      evidenceRefs: (matchingItems.length > 0
        ? matchingItems.map((item) => item.id)
        : [payload.id]).map((id) => ({
        kind: "dead-letter" as const,
        ref: `.kota/dead-letter-queue/items.json#${id}`,
      })),
      actionability: workflowShape?.actionability ?? classification.actionability,
      dedupeKey,
      observationCount: 1,
      createdAt: payload.updatedAt,
    });
  });
}
