import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { DiffSummaryConsistencyReport } from "./diff-summary-consistency-report.js";

export function renderDiffSummaryConsistency(
  report: DiffSummaryConsistencyReport,
): RenderNode[] {
  if (report.totalBuilderRuns === 0) {
    return [line(span("(no builder runs inspected for diff-summary consistency)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Builder runs: "),
      span(String(report.totalBuilderRuns), "accent"),
      plain("   Records: "),
      span(String(report.recordedRuns), "accent"),
      plain("   Mismatched: "),
      span(
        String(report.runsWithMismatches),
        report.runsWithMismatches > 0 ? "warn" : "success",
      ),
      plain("   Missing artifacts: "),
      span(
        String(missingArtifactCount(report)),
        missingArtifactCount(report) > 0 ? "warn" : "success",
      ),
    ),
  ];

  if (report.byCategory.length > 0) {
    lines.push(blank(), line(span("Mismatch categories", "muted", true)));
    for (const row of report.byCategory) {
      lines.push(line(
        plain("  "),
        span(String(row.count).padStart(3), "warn"),
        plain(" "),
        plain(row.category),
      ));
    }
  }

  if (report.missingData.length > 0) {
    lines.push(blank(), line(span("Missing data", "muted", true)));
    for (const row of report.missingData) {
      lines.push(line(
        plain("  "),
        span(String(row.count).padStart(3), row.kind === "artifact" ? "warn" : "muted"),
        plain(" "),
        plain(row.kind),
      ));
    }
  }

  if (report.examples.length > 0) {
    lines.push(blank(), line(span("Examples", "muted", true)));
    for (const example of report.examples) {
      const modules =
        example.moduleNames.length > 0 ? example.moduleNames.join(",") : "-";
      lines.push(line(
        plain("  "),
        span(example.categories.join(","), "warn"),
        plain(" "),
        plain(example.runId),
        plain(" "),
        span(example.taskId ?? "(no task)", "muted"),
        plain(` files=${example.changedFileCount}`),
        plain(` modules=${modules}`),
      ));
    }
  }

  return lines;
}

function missingArtifactCount(report: DiffSummaryConsistencyReport): number {
  return report.missingData.find((row) => row.kind === "artifact")?.count ?? 0;
}
