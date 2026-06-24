import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type {
  QualityRate,
  QualityStratificationReport,
  QualityStratificationSlice,
} from "./quality-stratification.js";
import { pct } from "./render-common.js";

export function renderQualityStratification(
  report: QualityStratificationReport,
): RenderNode[] {
  const totalSamples = report.aggregates.reduce(
    (sum, row) => sum + row.current.denominatorCount,
    0,
  );
  if (totalSamples === 0) {
    return [line(span("(no quality signals with rate denominators)", "muted"))];
  }

  const lines: RenderNode[] = [
    line(span("Aggregate quality rates", "muted", true)),
  ];
  for (const aggregate of report.aggregates) {
    lines.push(line(
      plain("  "),
      plain(aggregate.signal.padEnd(26)),
      plain(formatRate(aggregate.current).padStart(15)),
      plain("   prior "),
      plain(formatRate(aggregate.prior).padStart(15)),
      plain("   delta "),
      span(formatDelta(aggregate.rateDelta), aggregate.rateDelta && aggregate.rateDelta > 0 ? "warn" : "muted"),
      aggregate.weakEvidence ? span("   weak sample", "warn") : plain(""),
    ));
  }

  const notableSlices = report.slices
    .filter((slice) => slice.current.denominatorCount > 0)
    .slice(0, 8);
  if (notableSlices.length > 0) {
    lines.push(blank(), line(span("Largest slices", "muted", true)));
    for (const slice of notableSlices) {
      lines.push(renderSlice(slice));
    }
  }

  if (report.compositionShifts.length > 0) {
    lines.push(blank(), line(span("Composition shifts", "muted", true)));
    for (const shift of report.compositionShifts.slice(0, 5)) {
      lines.push(line(
        plain("  "),
        plain(`${shift.signal}/${shift.dimension}/${shift.value}`),
        plain(" "),
        span(
          `${pct(shift.currentSampleCount, shift.currentSampleCount + shift.priorSampleCount)} current mix`,
          "muted",
        ),
        plain(` (${shift.priorSampleCount} -> ${shift.currentSampleCount})`),
      ));
    }
  }

  if (report.missingDimensions.length > 0) {
    lines.push(blank(), line(span("Missing metadata", "muted", true)));
    for (const missing of report.missingDimensions.slice(0, 8)) {
      lines.push(line(plain(
        `  ${missing.signal.padEnd(26)} ${missing.dimension.padEnd(13)} ${missing.count}`,
      )));
    }
  }
  return lines;
}

function renderSlice(slice: QualityStratificationSlice): RenderNode {
  const refs = slice.references
    .map((ref) => ref.runId ?? ref.taskId ?? ref.artifact)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join(", ");
  return line(
    plain("  "),
    plain(`${slice.signal}/${slice.dimension}/${slice.value}`.padEnd(56)),
    plain(" "),
    span(formatRate(slice.current), slice.current.numeratorCount > 0 ? "warn" : "muted"),
    plain("   prior "),
    plain(formatRate(slice.prior)),
    slice.weakEvidence ? span("   weak", "warn") : plain(""),
    refs ? span(`   ${refs}`, "muted") : plain(""),
  );
}

function formatRate(rate: QualityRate): string {
  if (rate.denominatorCount === 0 || rate.rate === null) {
    return `n/a (${rate.numeratorCount}/${rate.denominatorCount})`;
  }
  return `${pct(rate.numeratorCount, rate.denominatorCount)} (${rate.numeratorCount}/${rate.denominatorCount})`;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "n/a";
  const percentage = `${(delta * 100).toFixed(1)}pp`;
  return delta > 0 ? `+${percentage}` : percentage;
}
