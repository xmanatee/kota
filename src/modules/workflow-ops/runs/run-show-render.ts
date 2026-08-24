import type { RepairSummary } from "#core/workflow/run-store-snapshot.js";
import { extractRepairSummary } from "#core/workflow/run-store-snapshot.js";
import type { WorkflowRunMetadata, WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import {
  json,
  type KVEntry,
  kvBlock,
  type LineNode,
  line,
  plain,
  type RenderNode,
  span,
  stack,
  type TextSpan,
} from "#modules/rendering/primitives.js";
import { formatDuration, statusIcon } from "../utils.js";
import { runStatusRole } from "./run-show-chain.js";

export function formatSkipReason(reason: WorkflowStepSkipReason): string {
  return reason.label ? `${reason.kind}:${reason.label}` : reason.kind;
}

export function formatWarningsSection(
  warnings: Array<{ type: string; message: string }>,
): string[] {
  return warnings.map((warning) => `  [${warning.type}] ${warning.message}`);
}

export function formatRepairLine(summary: RepairSummary): string {
  const noun = summary.attempts === 1 ? "repair" : "repairs";
  const costPart = summary.totalCostUsd > 0 ? ` ($${summary.totalCostUsd.toFixed(3)})` : "";
  const parts = summary.failedChecksByAttempt.map(
    (failures, index) => `[${index + 1}] ${failures.length > 0 ? failures.join(", ") : "passed"}`,
  );
  const repairLine = `Repairs: ${summary.attempts} ${noun}${costPart}${
    parts.length > 0 ? ` — ${parts.join(" / ")}` : ""
  }`;
  if (summary.continuation === undefined) return repairLine;
  return `${repairLine} — continuation ${summary.continuation.decision}: ${summary.continuation.summary}; next: ${summary.continuation.nextAction}`;
}

export function buildRunHeader(
  metadata: WorkflowRunMetadata,
  showPayload: boolean,
): RenderNode {
  const entries: KVEntry[] = [
    { label: "Run", value: metadata.id, role: "accent" },
    { label: "Workflow", value: metadata.workflow },
    {
      label: "Status",
      value: `${statusIcon(metadata.status)} ${metadata.status}`,
      role: runStatusRole(metadata.status),
    },
  ];
  if (metadata.retryOf) entries.push({ label: "Retry of", value: metadata.retryOf, role: "muted" });
  if (metadata.resumedFromRunId) {
    entries.push({ label: "Resumed from", value: metadata.resumedFromRunId, role: "muted" });
  }
  entries.push({ label: "Trigger", value: metadata.trigger.event });
  if (metadata.tags && metadata.tags.length > 0) {
    entries.push({ label: "Tags", value: metadata.tags.join(", "), role: "muted" });
  }
  entries.push({ label: "Started", value: new Date(metadata.startedAt).toLocaleString(), role: "muted" });
  if (metadata.completedAt) {
    entries.push({ label: "Finished", value: new Date(metadata.completedAt).toLocaleString(), role: "muted" });
  }
  if (metadata.durationMs != null) {
    entries.push({ label: "Duration", value: formatDuration(metadata.durationMs) });
  }
  if (metadata.totalCostUsd != null) {
    entries.push({ label: "Cost", value: `$${metadata.totalCostUsd.toFixed(4)}`, role: "muted" });
  }
  const nodes: RenderNode[] = [kvBlock(entries)];
  if (showPayload && metadata.trigger.payload && Object.keys(metadata.trigger.payload).length > 0) {
    nodes.push(json(metadata.trigger.payload, "Payload:"));
  }
  return stack(...nodes);
}

export function buildStepSpans(step: WorkflowRunMetadata["steps"][number]): {
  header: LineNode;
  detail: LineNode[];
} {
  const duration = formatDuration(step.durationMs);
  const icon = step.status === "failed" && step.continueOnFailure ? "⚠" : statusIcon(step.status);
  const reusedSuffix = (step as { reused?: boolean }).reused ? " (reused)" : "";
  const suffix = step.status === "failed" && step.continueOnFailure ? " (continued)" : reusedSuffix;
  const detail: LineNode[] = [];

  if (step.type === "parallel") {
    const header = line(plain(`  ${icon} ${step.id} [parallel] ${duration}${suffix}`));
    if (step.error) detail.push(line(plain(`      Error: ${step.error}`)));
    if (step.status === "skipped" && step.skipReason) {
      detail.push(line(plain(`      Skipped: ${formatSkipReason(step.skipReason)}`)));
    }
    const inner = (step.output as {
      steps?: Array<{
        id: string;
        type: string;
        status: string;
        durationMs: number;
        costUsd?: number;
        error?: string;
        continueOnFailure?: boolean;
      }>;
    } | null)?.steps ?? [];
    for (const child of inner) {
      const childIcon = child.status === "failed" && child.continueOnFailure
        ? "⚠"
        : statusIcon(child.status);
      const childSuffix = child.status === "failed" && child.continueOnFailure
        ? " (continued)"
        : "";
      const childCost = child.costUsd != null ? ` $${child.costUsd.toFixed(3)}` : " —";
      detail.push(line(plain(
        `    ║ ${childIcon} ${child.id} [${child.type}] ${formatDuration(child.durationMs)}${childCost}${childSuffix}`,
      )));
      if (child.error) detail.push(line(plain(`          Error: ${child.error}`)));
    }
    return { header, detail };
  }

  const repairSummary = extractRepairSummary(step.output);
  const baseCost = step.costUsd ?? null;
  const totalCost = baseCost !== null
    ? baseCost + (repairSummary?.totalCostUsd ?? 0)
    : (repairSummary?.totalCostUsd ?? null);
  const cost = totalCost !== null ? ` $${totalCost.toFixed(3)}` : " —";
  const header = line(plain(`  ${icon} ${step.id} [${step.type}] ${duration}${cost}${suffix}`));
  if (step.error) detail.push(line(plain(`      Error: ${step.error}`)));
  if (step.status === "skipped" && step.skipReason) {
    detail.push(line(plain(`      Skipped: ${formatSkipReason(step.skipReason)}`)));
  }
  if (step.type === "agent" && (step.harness || step.model)) {
    const parts = [step.harness, step.model].filter((value): value is string => Boolean(value));
    detail.push(line(plain(`      Harness: ${parts.join(" / ")}`)));
  }
  if (repairSummary) detail.push(line(plain(`      ${formatRepairLine(repairSummary)}`)));
  if (step.output !== undefined && step.output !== null) {
    const output = JSON.stringify(step.output);
    detail.push(line(plain(`      Output: ${output.length > 120 ? `${output.slice(0, 120)}…` : output}`)));
  }
  return { header, detail };
}

export function errorSpans(message: string): TextSpan[] {
  return [span(message, "error")];
}
