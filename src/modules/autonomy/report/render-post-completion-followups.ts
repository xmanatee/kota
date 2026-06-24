import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { PostCompletionFollowUpReport } from "./post-completion-followups.js";
import { pct } from "./render-common.js";

export function renderPostCompletionFollowUps(
  report: PostCompletionFollowUpReport,
): RenderNode[] {
  if (report.totalCorrectiveFollowUps === 0) {
    return [
      line(span("(no corrective follow-ups linked to recently completed tasks)", "muted")),
    ];
  }

  const lines: RenderNode[] = [
    line(
      plain("Corrective follow-ups: "),
      span(String(report.totalCorrectiveFollowUps), "accent"),
      plain("   Linked completed tasks: "),
      span(String(report.linkedCompletedTaskCount), "accent"),
    ),
    blank(),
    line(span("By reason", "muted", true)),
  ];

  for (const row of report.byReason) {
    lines.push(line(
      plain(`  ${row.reason.padEnd(22)} `),
      span(
        `${String(row.count).padStart(3)} (${pct(row.count, report.totalCorrectiveFollowUps)})`,
        reasonRole(row.reason),
      ),
    ));
  }

  if (report.links.length > 0) {
    lines.push(blank());
    lines.push(line(span("Linked follow-ups", "muted", true)));
    for (const link of report.links) {
      lines.push(line(
        plain("  "),
        span(link.activeFollowUpState.padEnd(7), "muted"),
        plain(" "),
        span(link.reasons.join(",").padEnd(24), reasonRole(link.reasons[0])),
        plain(" "),
        plain(link.completedTaskId),
        plain(" -> "),
        span(link.activeFollowUpTaskId, "accent"),
      ));
      lines.push(line(
        plain("    "),
        span(link.matchedRefs.slice(0, 3).join(", "), "muted"),
      ));
    }
  }

  return lines;
}

function reasonRole(
  reason: PostCompletionFollowUpReport["byReason"][number]["reason"] | undefined,
): "error" | "warn" | "info" | "muted" {
  switch (reason) {
    case "regression":
    case "security":
    case "missing-evidence":
      return "error";
    case "review-scrutiny":
    case "trajectory-diagnostic":
    case "workflow-failure":
    case "source-size":
      return "warn";
    case "operator-report":
      return "info";
    case undefined:
      return "muted";
  }
}
