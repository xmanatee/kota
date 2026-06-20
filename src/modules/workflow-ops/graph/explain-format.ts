import { formatDuration } from "../utils.js";
import type {
  AutomationBatchSummary,
  AutomationExplainResult,
} from "./types.js";

export function formatAutomationExplainResult(result: AutomationExplainResult): string {
  const lines: string[] = [];
  lines.push("Automation Explain");
  lines.push("==================");
  if (result.query.workflowName) lines.push(`Workflow: ${result.query.workflowName}`);
  if (result.query.eventName) lines.push(`Event: ${result.query.eventName}`);
  lines.push(`Outcome: ${result.outcome}`);
  lines.push("");
  lines.push("Matches:");
  if (result.matches.length === 0) {
    lines.push("  (none)");
  } else {
    for (const match of result.matches) {
      const batch = match.batch
        ? ` batch(max=${match.batch.maxCount ?? "time"}, buffer=${match.batch.maxBufferSize})`
        : "";
      lines.push(`  - ${match.workflow} trigger#${match.triggerIndex} ${match.triggerEvent}${batch}`);
      for (const effect of match.effects) {
        lines.push(`    effect: ${effect.effectId} risk=${effect.risk}`);
      }
      for (const edge of match.downstream) {
        lines.push(`    downstream: ${edge.kind} ${edge.target}`);
      }
    }
  }
  lines.push("");
  lines.push("Reasons:");
  if (result.reasons.length === 0) {
    lines.push("  (none)");
  } else {
    for (const reason of result.reasons) {
      const where = reason.workflow ? ` [${reason.workflow}]` : "";
      lines.push(`  - ${reason.severity}${where}: ${reason.message}`);
    }
  }
  if (result.redactedSamplePayload) {
    lines.push("");
    lines.push("Redacted sample payload:");
    lines.push(JSON.stringify(result.redactedSamplePayload, null, 2));
  }
  return lines.join("\n");
}

export function formatAutomationBatchSummary(batch: AutomationBatchSummary): string {
  const parts: string[] = [];
  if (batch.maxCount !== undefined) parts.push(`${batch.maxCount} event(s)`);
  if (batch.maxAgeMs !== undefined) parts.push(formatDuration(batch.maxAgeMs));
  if (batch.idleTimeoutMs !== undefined) parts.push(`${formatDuration(batch.idleTimeoutMs)} idle`);
  if (batch.flushEvent) parts.push(`flush=${batch.flushEvent}`);
  return parts.length > 0 ? parts.join(", ") : "manual flush only";
}
