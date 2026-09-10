import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { autonomyInspectionRoots } from "./inspection-roots.js";
import { aggregateAutonomyReport } from "./report/aggregate.js";
import { attachControlCoverageToReport } from "./report/control-coverage-report-window.js";
import { renderOnDemandAttention } from "./workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "./workflows/daily-digest/on-demand.js";

type InspectionRoots = ReturnType<typeof autonomyInspectionRoots>;
type ReportInput = InspectionRoots & { days: number; windowEndMs: number };
type DigestInput = InspectionRoots & { windowEndMs: number };

export function inspectAttention(input: InspectionRoots) {
  const scopeRoot = input.workspaceRoot;
  const result = renderOnDemandAttention({ scopeRoot, runsDir: input.runsDir, authority: { stateDir: input.stateDir, scopeRoot } });
  return { data: { items: result.items }, text: result.text };
}

export function inspectDigest(input: DigestInput) {
  return renderOnDemandDigest({ scopeRoot: input.workspaceRoot, stateDir: input.stateDir, windowEndMs: input.windowEndMs });
}

export function inspectReport(input: ReportInput) {
  const report = aggregateAutonomyReport({ ...input, windowDays: input.days });
  return attachControlCoverageToReport(report, {
    ...input, scopeRoot: input.workspaceRoot,
    windowStartMs: input.windowEndMs - input.days * 24 * 60 * 60 * 1000,
  });
}

export const attentionInspectionOperation = defineWorkflowBlockingOperation<InspectionRoots, ReturnType<typeof inspectAttention>>(import.meta.url, "inspectAttention");
export const digestInspectionOperation = defineWorkflowBlockingOperation<DigestInput, ReturnType<typeof inspectDigest>>(import.meta.url, "inspectDigest");
export const reportInspectionOperation = defineWorkflowBlockingOperation<ReportInput, ReturnType<typeof inspectReport>>(import.meta.url, "inspectReport");
