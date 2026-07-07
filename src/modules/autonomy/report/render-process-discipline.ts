import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { ProcessDisciplineReport } from "./aggregate.js";

export function renderProcessDiscipline(
  report: ProcessDisciplineReport,
): RenderNode[] {
  if (report.totalRecords === 0) {
    return [line(span("(no process-discipline records)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Records: "),
      span(String(report.totalRecords), "accent"),
      plain("   Rubric: "),
      span(report.rubricVersion, "muted"),
    ),
    blank(),
    line(span("Grouped scores", "muted", true)),
  ];
  for (const group of report.groups.slice(0, 12)) {
    lines.push(line(
      plain("  "),
      plain(`${group.dimension}/${group.value}`.padEnd(34)),
      plain(" "),
      span(formatProcessScore(group.averageScore), scoreRole(group.averageScore)),
      plain(`   n=${group.sampleCount}`),
      group.weakSample ? span(" weak sample", "warn") : plain(""),
      plain("   grades "),
      span(formatGradeCounts(group.gradeCounts), "muted"),
      group.missingEvidenceDimensions > 0
        ? span(`   missing=${group.missingEvidenceDimensions}`, "warn")
        : plain(""),
      group.unsupportedDimensions > 0
        ? span(`   unsupported=${group.unsupportedDimensions}`, "warn")
        : plain(""),
    ));
  }
  return lines;
}

function formatProcessScore(score: number | null): string {
  return score === null ? "n/a" : `${score}/100`;
}

function scoreRole(score: number | null): "accent" | "warn" | "muted" {
  if (score === null) return "muted";
  return score >= 80 ? "accent" : "warn";
}

function formatGradeCounts(
  counts: ProcessDisciplineReport["groups"][number]["gradeCounts"],
): string {
  return counts.map((entry) => `${entry.grade}:${entry.count}`).join(",");
}
