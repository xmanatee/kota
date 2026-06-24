import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { OwnerInterventionReport } from "./aggregate.js";
import { pct } from "./render-common.js";

export function renderOwnerInterventions(
  report: OwnerInterventionReport,
): RenderNode[] {
  if (report.totalQuestions === 0) {
    return [line(span("(no owner-question pressure)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Questions: "),
      span(String(report.totalQuestions), "accent"),
      plain("   Pending: "),
      span(String(report.pending), report.stalePending > 0 ? "warn" : "accent"),
      plain("   Stale pending: "),
      span(String(report.stalePending), report.stalePending > 0 ? "warn" : "accent"),
      plain("   Timeouts: "),
      span(String(report.timeouts), report.timeouts > 0 ? "warn" : "accent"),
      plain("   Answered corrections: "),
      span(
        String(report.answeredCorrections),
        report.answeredCorrections > 0 ? "warn" : "accent",
      ),
    ),
  ];
  if (report.legacyUnknown > 0) {
    lines.push(line(
      span(`  ${report.legacyUnknown} legacy/unknown record(s) normalized.`, "muted"),
    ));
  }
  lines.push(blank());
  lines.push(line(span("By status", "muted", true)));
  for (const row of report.byStatus) {
    lines.push(line(plain(
      `  ${row.status.padEnd(10)} ${String(row.count).padStart(3)} (${pct(row.count, report.totalQuestions)})`,
    )));
  }
  lines.push(blank());
  lines.push(line(span("By outcome", "muted", true)));
  for (const row of report.byOutcome) {
    lines.push(line(plain(
      `  ${row.outcome.padEnd(24)} ${String(row.count).padStart(3)} (${pct(row.count, report.totalQuestions)})`,
    )));
  }
  appendPressureBuckets(lines, "Top sources", report.bySource);
  appendPressureBuckets(lines, "Top workflows", report.byWorkflow);
  if (report.byTask.length > 0) appendPressureBuckets(lines, "Top tasks", report.byTask);
  appendRecurringPatterns(lines, "Recurring patterns", report.recurringPatterns.activePatterns);
  appendRecurringPatterns(
    lines,
    "Ignored recurring patterns",
    report.recurringPatterns.ignoredPatterns,
  );
  if (report.records.length > 0) {
    lines.push(blank());
    lines.push(line(span("Recent refs", "muted", true)));
    for (const record of report.records.slice(0, 8)) {
      const refs = [
        record.refs.question,
        record.refs.run,
        record.refs.task,
      ].filter((ref): ref is string => ref !== null);
      const flags = record.markers.length > 0
        ? ` [${record.markers.join(",")}]`
        : "";
      lines.push(line(
        plain("  "),
        span(record.status.padEnd(9), statusRole(record.status, record.markers)),
        plain(" "),
        plain(record.outcomeBucket.padEnd(24)),
        plain(" "),
        span(refs.join(" "), "muted"),
        span(flags, "muted"),
      ));
    }
  }
  return lines;
}

function appendRecurringPatterns(
  lines: RenderNode[],
  label: string,
  patterns: OwnerInterventionReport["recurringPatterns"]["activePatterns"],
): void {
  if (patterns.length === 0) return;
  lines.push(blank());
  lines.push(line(span(label, "muted", true)));
  for (const pattern of patterns.slice(0, 5)) {
    lines.push(line(plain(
      `  ${pattern.kind.padEnd(28)} ${pattern.dimension.kind}:${pattern.dimension.value} ` +
      `${String(pattern.questionCount).padStart(2)} questions   ` +
      `task ${pattern.repairTaskId}   action ${pattern.action}`,
    )));
  }
}

function appendPressureBuckets(
  lines: RenderNode[],
  label: string,
  buckets: OwnerInterventionReport["bySource"],
): void {
  if (buckets.length === 0) return;
  lines.push(blank());
  lines.push(line(span(label, "muted", true)));
  for (const bucket of buckets.slice(0, 8)) {
    lines.push(line(plain(
      `  ${bucket.key.padEnd(24)} ${String(bucket.total).padStart(3)} total   ${String(bucket.stalePending).padStart(2)} stale   ${String(bucket.timeouts).padStart(2)} timeout   ${String(bucket.answeredCorrections).padStart(2)} correction`,
    )));
  }
}

function statusRole(
  status: string,
  markers: readonly string[],
): "accent" | "warn" | "muted" {
  if (markers.includes("stale-pending") || markers.includes("resolved-by-timeout")) {
    return "warn";
  }
  return status === "pending" ? "accent" : "muted";
}
