import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { ShadowSemanticReviewReport } from "./aggregate.js";
import { fmtUsd } from "./render-common.js";

function fmtDuration(ms: number | null): string {
  if (ms === null) return "n/a";
  if (ms < 1_000) return `${ms}ms`;
  return `${Math.round(ms / 1_000)}s`;
}

export function renderShadowSemanticReviews(
  report: ShadowSemanticReviewReport,
): RenderNode[] {
  if (report.totalArtifacts === 0) {
    return [line(span("(no shadow semantic review artifacts)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Artifacts: "),
      span(String(report.totalArtifacts), "accent"),
      plain("   Reviewed: "),
      span(String(report.reviewed), "accent"),
      plain("   Catches: "),
      span(String(report.catches), report.catches > 0 ? "warn" : "accent"),
      plain("   False positives: "),
      span(String(report.falsePositiveAnnotations), "accent"),
      plain("   Skipped: "),
      span(String(report.skippedTargetResolution), "accent"),
      plain("   Malformed: "),
      span(String(report.malformedArtifacts), report.malformedArtifacts > 0 ? "warn" : "accent"),
      plain("   Errors: "),
      span(String(report.errorArtifacts), report.errorArtifacts > 0 ? "warn" : "accent"),
    ),
    line(
      plain("Cost: "),
      span(fmtUsd(report.totalCostUsd), "accent"),
      plain("   Avg duration: "),
      span(fmtDuration(report.averageDurationMs), "muted"),
    ),
  ];
  if (report.byWorkflow.length > 0) {
    lines.push(blank(), line(span("By workflow", "muted", true)));
    for (const row of report.byWorkflow) {
      lines.push(line(plain(
        `  ${row.workflow.padEnd(18)} ${String(row.artifacts).padStart(3)} artifacts   ${String(row.catches).padStart(3)} catches   ${String(row.falsePositiveAnnotations).padStart(3)} false+   ${String(row.skippedTargetResolution).padStart(3)} skipped   ${String(row.malformedArtifacts).padStart(3)} malformed   ${fmtUsd(row.totalCostUsd).padStart(8)}`,
      )));
    }
  }
  const notable = report.records.filter((record) =>
    record.catchCount > 0 ||
    record.falsePositiveCount > 0 ||
    record.status === "skipped" ||
    record.status === "malformed" ||
    record.status === "error"
  );
  if (notable.length > 0) {
    lines.push(blank(), line(span("Recent review refs", "muted", true)));
    for (const record of notable.slice(0, 8)) {
      const marker = record.status === "reviewed"
        ? `${record.catchCount} catch / ${record.falsePositiveCount} false+`
        : record.skippedReason ?? record.status;
      lines.push(line(
        plain("  "),
        span(record.workflow.padEnd(18), record.catchCount > 0 ? "warn" : "muted"),
        plain(" "),
        plain(record.declarationId.padEnd(32)),
        plain(" "),
        span(marker, record.status === "reviewed" && record.catchCount === 0 ? "muted" : "warn"),
        plain(" "),
        span(record.artifact, "muted"),
      ));
    }
  }
  if (report.unsupported.length > 0) {
    lines.push(blank(), line(span("Unsupported artifacts", "muted", true)));
    for (const item of report.unsupported.slice(0, 5)) {
      lines.push(line(
        plain("  "),
        span(item.workflow.padEnd(18), "warn"),
        plain(" "),
        plain(item.artifact),
        plain(" "),
        span(item.reason, "muted"),
      ));
    }
  }
  return lines;
}
