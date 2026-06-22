import {
  blank,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { ControlMonitorCoverageReport } from "./control-coverage-report.js";

export function renderControlCoverage(
  report: ControlMonitorCoverageReport,
): RenderNode[] {
  if (report.artifactCount === 0) {
    return [line(span("(no control coverage artifacts)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Artifacts: "),
      span(String(report.artifactCount), "accent"),
      plain("   Runs with gaps: "),
      span(String(report.runsWithGaps), report.runsWithGaps > 0 ? "warn" : "success"),
      plain("   Gaps: "),
      span(String(report.totalGaps), report.totalGaps > 0 ? "warn" : "success"),
    ),
    blank(),
    line(span("Control states", "muted", true)),
    kvBlock(controlStateEntries(report), 14),
  ];
  lines.push(blank(), ...renderAsyncReviewerTiming(report));
  if (report.topGaps.length > 0) {
    lines.push(blank(), line(span("Top gaps", "muted", true)));
    for (const gap of report.topGaps) {
      lines.push(
        line(
          plain("  "),
          span(`${String(gap.count).padStart(2)}x`, gap.severity === "error" ? "error" : "warn"),
          plain(" "),
          plain(gap.family.padEnd(24)),
          plain(" "),
          span(gap.reason, gap.severity === "error" ? "error" : "warn"),
        ),
      );
    }
  }
  if (report.recentArtifactPaths.length > 0) {
    lines.push(blank(), line(span("Recent artifacts", "muted", true)));
    for (const artifactPath of report.recentArtifactPaths) {
      lines.push(line(plain(`  ${artifactPath}`)));
    }
  }
  return lines;
}

function controlStateEntries(report: ControlMonitorCoverageReport): KVEntry[] {
  return [
    { label: "pending", value: String(report.pendingFamilies) },
    { label: "unsupported", value: String(report.unsupportedFamilies) },
    { label: "blocked", value: String(report.blockedFamilies) },
    { label: "warned", value: String(report.warnedFamilies) },
  ];
}

function renderAsyncReviewerTiming(
  report: ControlMonitorCoverageReport,
): RenderNode[] {
  const timings = report.asyncReviewResponseMs;
  if (timings.observations === 0 || timings.average === null) {
    return [line(span("(no async reviewer timing observations)", "muted"))];
  }
  return [
    line(
      span("Async reviewer response", "muted", true),
      plain(
        ` avg ${timings.average}ms, n=${timings.observations}, min ${timings.min ?? 0}ms, max ${timings.max ?? 0}ms`,
      ),
    ),
  ];
}
