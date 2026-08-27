import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { DecisionAttributionReport } from "./aggregate.js";
import { pct } from "./render-common.js";

export function renderDecisionAttribution(
  report: DecisionAttributionReport,
): RenderNode[] {
  if (report.totalRuns === 0) {
    return [line(span("(no autonomy runs classified)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Runs classified: "),
      span(String(report.totalRuns), "accent"),
    ),
    blank(),
  ];
  appendCounts(lines, "Planning attribution", report.byPlanning, "attribution", report.totalRuns);
  lines.push(blank());
  appendCounts(lines, "Execution attribution", report.byExecution, "attribution", report.totalRuns);
  if (report.byWorkMode.length > 0) {
    lines.push(blank());
    appendCounts(lines, "Work mode / workflow", report.byWorkMode, "workMode", report.totalRuns);
  }
  if (report.hardSuccessSignals.length > 0) {
    lines.push(blank());
    appendSignalCounts(lines, "Hard success signals", report.hardSuccessSignals);
  }
  if (report.troubleSignals.length > 0) {
    lines.push(blank());
    appendSignalCounts(lines, "Trouble signals", report.troubleSignals);
  }
  if (report.warnings.length > 0) {
    lines.push(blank());
    lines.push(line(span("Warnings", "muted", true)));
    for (const warning of report.warnings) {
      lines.push(line(
        plain("  "),
        span(`${warning.kind} (${warning.count})`, "warn"),
        plain(" "),
        plain(warning.message),
      ));
      lines.push(line(
        plain("    refs: "),
        span(warning.refs.join(", "), "muted"),
      ));
    }
  }
  if (report.records.length > 0) {
    lines.push(blank());
    lines.push(line(span("Recent run attribution", "muted", true)));
    for (const record of report.records.slice(0, 8)) {
      lines.push(line(
        plain("  "),
        span(record.workMode.padEnd(16), "info"),
        plain(" "),
        plain(`${record.planning}/${record.execution}`.padEnd(15)),
        plain(" "),
        plain(record.runId),
        plain(" "),
        span(record.taskId ?? "(no task)", "muted"),
      ));
      const hard = record.hardSuccessSignals.join(", ") || "none";
      const trouble = record.troubleSignals.join(", ") || "none";
      lines.push(line(
        plain("    hard: "),
        span(hard, hard === "none" ? "muted" : "success"),
        plain("   trouble: "),
        span(trouble, trouble === "none" ? "muted" : "warn"),
      ));
    }
  }
  return lines;
}

function appendCounts<TKey extends "attribution" | "workMode">(
  lines: RenderNode[],
  label: string,
  rows: readonly ({ count: number } & Record<TKey, string>)[],
  key: TKey,
  total: number,
): void {
  lines.push(line(span(label, "muted", true)));
  for (const row of rows) {
    lines.push(line(plain(
      `  ${row[key].padEnd(18)} ${String(row.count).padStart(3)} (${pct(row.count, total)})`,
    )));
  }
}

function appendSignalCounts(
  lines: RenderNode[],
  label: string,
  rows: readonly { signal: string; count: number }[],
): void {
  lines.push(line(span(label, "muted", true)));
  for (const row of rows) {
    lines.push(line(plain(
      `  ${row.signal.padEnd(42)} ${String(row.count).padStart(3)}`,
    )));
  }
}
