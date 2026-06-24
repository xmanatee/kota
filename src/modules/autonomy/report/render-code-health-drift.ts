import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type {
  CodeHealthCleanupCoverage,
  CodeHealthDriftRecord,
  CodeHealthDriftReport,
  CodeHealthRepeatedSurface,
} from "./code-health-drift.js";

export function renderCodeHealthDrift(
  report: CodeHealthDriftReport,
): RenderNode[] {
  if (report.totalBuilderRuns === 0 && report.unsupportedArtifacts === 0) {
    return [line(span("(no builder runs inspected for code-health drift)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Builder runs inspected: "),
      span(String(report.totalBuilderRuns), "accent"),
      plain("   Runs with warnings: "),
      span(String(report.runsWithWarnings), report.runsWithWarnings > 0 ? "warn" : "accent"),
      plain("   Unsupported: "),
      span(String(report.unsupportedArtifacts), report.unsupportedArtifacts > 0 ? "warn" : "accent"),
    ),
    blank(),
    line(span("Trend", "muted", true)),
  ];
  for (const bucket of report.trendBuckets) {
    lines.push(line(
      plain(`  ${bucket.bucket.padEnd(7)} `),
      plain(`${String(bucket.totalBuilderRuns).padStart(3)} runs   `),
      span(`${String(bucket.runsWithWarnings).padStart(3)} warning runs`, bucket.runsWithWarnings > 0 ? "warn" : "accent"),
      plain(`   ${String(bucket.warningRecords).padStart(3)} warning(s)   `),
      span(`${String(bucket.cleanupExceptionRuns).padStart(3)} cleanup exception(s)`, "muted"),
    ));
  }
  appendCountRows(lines, "By warning family", report.byWarningFamily);
  appendCountRows(lines, "By source area", report.bySurfaceArea);
  appendRepeatedSurfaces(lines, report.repeatedSurfaces);
  appendRecords(lines, report.records);
  return lines;
}

function appendCountRows(
  lines: RenderNode[],
  label: string,
  rows: readonly { key: string; count: number }[],
): void {
  if (rows.length === 0) return;
  lines.push(blank(), line(span(label, "muted", true)));
  for (const row of rows) {
    lines.push(line(plain(`  ${row.key.padEnd(24)} ${String(row.count).padStart(3)}`)));
  }
}

function appendRepeatedSurfaces(
  lines: RenderNode[],
  surfaces: readonly CodeHealthRepeatedSurface[],
): void {
  if (surfaces.length === 0) return;
  lines.push(blank(), line(span("Repeated warning surfaces", "muted", true)));
  for (const surface of surfaces) {
    lines.push(line(
      plain("  "),
      span(surface.file, surface.currentWarnings > 0 ? "warn" : "muted"),
      plain(` current=${surface.currentWarnings} prior=${surface.priorWarnings} `),
      span(`latest=${surface.latestRunId}`, "muted"),
    ));
    lines.push(line(
      plain("    coverage: "),
      span(renderCoverage(surface.cleanupCoverage), surface.cleanupCoverage.length > 0 ? "accent" : "warn"),
    ));
  }
}

function appendRecords(
  lines: RenderNode[],
  records: readonly CodeHealthDriftRecord[],
): void {
  if (records.length === 0) return;
  lines.push(blank(), line(span("Recent refs", "muted", true)));
  for (const record of records.slice(0, 8)) {
    lines.push(line(
      plain("  "),
      span(record.outcome.padEnd(17), record.outcome === "warning" ? "warn" : "accent"),
      plain(" "),
      plain(record.runId),
      plain(" "),
      span(record.taskId ?? "(unresolved task)", "muted"),
      plain(" "),
      span(shortCommit(record.commitRef), "muted"),
    ));
    lines.push(line(plain(`    ${record.files.join(", ")}`)));
  }
}

function renderCoverage(coverage: readonly CodeHealthCleanupCoverage[]): string {
  if (coverage.length === 0) return "uncovered";
  return coverage.map((item) => {
    if (item.kind === "open-cleanup-task") {
      return `${item.taskId} (${item.taskState})`;
    }
    return `${item.taskPath} via ${item.runId}`;
  }).join("; ");
}

function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 12) : "(no commit)";
}
