import { join } from "node:path";
import type {
  DeadLetterFailureClass,
  DeadLetterItem,
} from "#core/daemon/dead-letter-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import {
  addPattern,
  type PatternInput,
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

function parseAgentFailureSubtype(reason: string): string | undefined {
  const match = /\(([^)]+)\):/.exec(reason);
  return match?.[1];
}

function deadLetterCategory(
  item: DeadLetterItem,
): Pick<PatternInput, "category" | "actionability" | "labels" | "severity"> & {
  failureClass: DeadLetterFailureClass;
} {
  const agentFailureClass = classifyAgentRuntimeFailure({
    message: item.failure.reason,
    subtype: parseAgentFailureSubtype(item.failure.reason),
  })?.kind;
  const failureClass = agentFailureClass ?? item.failure.lastErrorClass;

  switch (failureClass) {
    case "auth":
    case "provider":
    case "rate_limit":
      return {
        failureClass,
        category: "external-service/auth",
        actionability: "external-service",
        labels: ["dead-letter", "external-service", failureClass],
        severity: "warning",
      };
    case "schema":
    case "validation":
    case "execution":
    case "runtime":
    case "unknown":
      return {
        failureClass,
        category: "local-code",
        actionability: "local-code",
        labels: ["dead-letter", "local-code", failureClass],
        severity: "error",
      };
  }
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

    const classification = deadLetterCategory(item);
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
