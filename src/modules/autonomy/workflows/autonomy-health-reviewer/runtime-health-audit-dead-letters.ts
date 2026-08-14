import { join } from "node:path";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { deadLetterHealthCategory } from "#modules/autonomy/dead-letter-health.js";
import {
  addPattern,
  type RuntimeHealthAuditContext,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type DeadLetterSnapshot = {
  items: DeadLetterItem[];
};

function dlqWorkflowKey(item: DeadLetterItem): string {
  const workflow =
    item.affectedWorkflowNames[0] ??
    (item.source.kind === "workflow-dispatch" ? item.source.workflowName : null);
  return workflow ?? item.owningModule;
}

export function scanDeadLetters(ctx: RuntimeHealthAuditContext): void {
  const path = join(ctx.projectDir, ".kota", "dead-letter-queue", "items.json");
  const snapshot = readOptionalJsonFile<DeadLetterSnapshot>(path);
  if (!snapshot) return;
  ctx.inspected.deadLetterItems = snapshot.items.length;

  for (const item of snapshot.items) {
    if (item.status !== "open") continue;
    const updatedMs = Date.parse(item.updatedAt);
    if (!Number.isFinite(updatedMs)) continue;
    if (ctx.nowMs - updatedMs < ctx.staleDeadLetterMs) continue;
    ctx.inspected.staleOpenDeadLetterItems += 1;

    const classification = deadLetterHealthCategory(item.failure);
    const workflowKey = dlqWorkflowKey(item);
    addPattern(ctx, {
      dedupeKey:
        `dead-letter:${classification.failureClass}:${item.owningModule}:${workflowKey}`.toLowerCase(),
      category: classification.category,
      severity: classification.severity,
      actionability: classification.actionability,
      labels: classification.labels,
      summary:
        `Stale open dead-letter item ${item.id} has remained open since ${item.updatedAt}.`,
      source: { kind: "dead-letter", id: item.id },
      evidenceRefs: [
        {
          kind: "dead-letter",
          ref: `.kota/dead-letter-queue/items.json#${item.id}`,
          summary: truncateSingleLine(
            `${item.id}: ${item.failure.lastErrorClass} ${item.failure.reason}`,
          ),
        },
      ],
    });
  }
}
