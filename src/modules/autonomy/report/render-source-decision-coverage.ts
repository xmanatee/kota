import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import {
  SOURCE_DISPOSITIONS,
  type SourceDecisionCoverageRecord,
  type SourceDecisionCoverageReport,
  type SourceDecisionDisposition,
} from "./source-decision-coverage.js";

export function renderSourceDecisionCoverageReport(
  report: SourceDecisionCoverageReport,
): RenderNode {
  const lines: RenderNode[] = [
    line(
      plain("Source decision coverage — "),
      span(String(report.selectedSources), "accent"),
      plain(" selected of "),
      span(String(report.totalSources), "muted"),
      plain(" watchlist source"),
      plain(report.totalSources === 1 ? "" : "s"),
    ),
    line(
      plain("Warnings: "),
      span(`${report.staleWarningCount} stale`, report.staleWarningCount > 0 ? "warn" : "muted"),
      plain(", "),
      span(
        `${report.unverifiedWarningCount} unverified`,
        report.unverifiedWarningCount > 0 ? "warn" : "muted",
      ),
      plain(` (stale threshold ${report.staleAfterDays} days)`),
    ),
    blank(),
  ];

  appendCounts(lines, "By disposition", report.byDisposition, "disposition");
  lines.push(blank());
  appendCounts(lines, "By coverage status", report.byCoverageStatus, "coverageStatus");
  lines.push(blank());
  lines.push(line(span("Records by disposition", "muted", true)));
  if (report.records.length === 0) {
    lines.push(line(span("  (no sources selected)", "muted")));
    return { kind: "stack", children: lines };
  }
  for (const disposition of SOURCE_DISPOSITIONS) {
    const records = report.records.filter((record) => record.disposition === disposition);
    if (records.length === 0) continue;
    lines.push(line(span(`  ${disposition} (${records.length})`, dispositionRole(disposition), true)));
    for (const record of records) appendRecord(lines, record);
  }
  return { kind: "stack", children: lines };
}

function appendRecord(
  lines: RenderNode[],
  record: SourceDecisionCoverageRecord,
): void {
  lines.push(line(plain("    "), span(record.source, "info")));
  lines.push(line(
    plain("      coverage: "),
    span(record.coverageStatuses.join(", "), coverageRole(record.coverageStatuses)),
  ));
  lines.push(line(plain("      decision: "), plain(record.decisionSummary)));
  if (record.coveredByDoneTasks.length > 0) {
    lines.push(line(
      plain("      done: "),
      span(record.coveredByDoneTasks.map((task) => `${task.id} (${task.state})`).join(", "), "success"),
    ));
  }
  if (record.coveredByOpenTasks.length > 0) {
    lines.push(line(
      plain("      open: "),
      span(record.coveredByOpenTasks.map((task) => `${task.id} (${task.state})`).join(", "), "warn"),
    ));
  }
  if (record.localDecisionRefs.length > 0) {
    lines.push(line(
      plain("      refs: "),
      span(record.localDecisionRefs.join(", "), "muted"),
    ));
  }
  if (record.remainingGap !== null) {
    lines.push(line(plain("      gap: "), span(record.remainingGap, "warn")));
  }
  if (record.warnings.length > 0) {
    lines.push(line(
      plain("      warnings: "),
      span(record.warnings.map((warning) => warning.message).join("; "), "warn"),
    ));
  }
}

function appendCounts<TKey extends "disposition" | "coverageStatus">(
  lines: RenderNode[],
  label: string,
  rows: readonly ({ count: number } & Record<TKey, string>)[],
  key: TKey,
): void {
  lines.push(line(span(label, "muted", true)));
  for (const row of rows) {
    lines.push(line(plain(`  ${row[key].padEnd(24)} ${String(row.count).padStart(3)}`)));
  }
}

function dispositionRole(
  disposition: SourceDecisionDisposition,
): "success" | "warn" | "error" | "info" | "muted" {
  switch (disposition) {
    case "adopt":
      return "success";
    case "partial-adopt":
      return "warn";
    case "reject":
      return "error";
    case "watch":
      return "info";
    case "no-op":
    case "needs-research":
      return "muted";
  }
}

function coverageRole(
  statuses: readonly string[],
): "success" | "warn" | "info" | "muted" {
  if (statuses.includes("covered-by-done-task")) return "success";
  if (statuses.includes("covered-by-open-task")) return "warn";
  if (statuses.includes("local-decision")) return "info";
  return "muted";
}
