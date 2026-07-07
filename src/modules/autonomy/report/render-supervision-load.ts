import {
  blank,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import { safeTerminalLineText } from "#modules/rendering/safe-terminal-text.js";
import type { SupervisionLoadReport } from "./aggregate.js";
import { priorityLabel, priorityRole, taskClassRole } from "./render-common.js";

export function renderSupervisionLoad(
  report: SupervisionLoadReport,
): RenderNode[] {
  const statusRole = supervisionStatusRole(report.status);
  const scoreText = report.score.score === null
    ? `known score ${report.score.knownScore}`
    : `score ${report.score.score}`;
  const lines: RenderNode[] = [
    line(
      plain("Status: "),
      span(report.status, statusRole),
      plain(` (${scoreText}; busy >= ${report.thresholds.busyAt}, overloaded >= ${report.thresholds.overloadedAt})`),
    ),
    blank(),
    line(span("Counts", "muted", true)),
    kvBlock(countEntries(report), 28),
    blank(),
    line(span("Evidence", "muted", true)),
    ...evidenceLines(report),
  ];

  if (report.workstreams.length > 0) {
    lines.push(blank());
    lines.push(line(span("Workstreams", "muted", true)));
    for (const group of report.workstreams.slice(0, 8)) {
      const workflow = safeTerminalLineText(group.workflow);
      const taskClass = safeTerminalLineText(group.taskClass);
      const scope = group.scopeId
        ? ` scope=${safeTerminalLineText(group.scopeId)}`
        : "";
      lines.push(line(
        plain("  "),
        span(workflow.padEnd(22), "info"),
        plain(" "),
        span(taskClass, taskClassRole(group.taskClass)),
        plain(" "),
        span(priorityLabel(group.priority), priorityRole(group.priority)),
        plain(` runs=${group.activeRuns} claims=${group.taskClaims}`),
        group.pendingMergeTaskClaims > 0
          ? span(` pending-merge=${group.pendingMergeTaskClaims}`, "warn")
          : plain(""),
        plain(scope),
      ));
    }
  }

  if (report.topReferences.length > 0) {
    lines.push(blank());
    lines.push(line(span("Top references", "muted", true)));
    for (const ref of report.topReferences) {
      const id = safeTerminalLineText(ref.id);
      const task = ref.taskId ? ` task=${safeTerminalLineText(ref.taskId)}` : "";
      const workflow = ref.workflow
        ? ` workflow=${safeTerminalLineText(ref.workflow)}`
        : "";
      const scope = ref.scopeId ? ` scope=${safeTerminalLineText(ref.scopeId)}` : "";
      const reason = safeTerminalLineText(ref.reason);
      lines.push(line(
        plain("  "),
        span(ref.kind, referenceRole(ref.kind)),
        plain(` ${id}${workflow}${task}${scope} - ${reason}`),
      ));
    }
  }

  return lines;
}

function countEntries(report: SupervisionLoadReport): KVEntry[] {
  return [
    countEntry("active runs", report.counts.activeRuns),
    countEntry("task claims", report.counts.activeTaskClaims),
    countEntry("pending-merge claims", report.counts.pendingMergeTaskClaims),
    countEntry("blocked claim recoveries", report.counts.blockedClaimRecoveries),
    countEntry("pending approvals", report.counts.pendingApprovals),
    countEntry("pending owner questions", report.counts.pendingOwnerQuestions),
    countEntry("open dead letters", report.counts.openDeadLetters),
    countEntry("attention items", report.counts.attentionItems),
    countEntry("post-completion follow-ups", report.counts.postCompletionFollowUps),
    countEntry("review evidence gaps", report.counts.reviewEvidenceGaps),
  ];
}

function countEntry(label: string, value: number | null): KVEntry {
  return {
    label,
    value: value === null ? "unknown" : String(value),
    role: value === null ? "warn" : undefined,
  };
}

function evidenceLines(report: SupervisionLoadReport): RenderNode[] {
  if (report.evidence.length === 0) {
    return [line(span("(no evidence sources checked)", "muted"))];
  }
  return report.evidence.map((item) =>
    line(
      plain("  "),
      span(item.status.padEnd(9), evidenceRole(item.status)),
      plain(` ${item.source}: ${item.message}`),
    ),
  );
}

function supervisionStatusRole(
  status: SupervisionLoadReport["status"],
): "success" | "warn" | "error" | "muted" {
  switch (status) {
    case "normal":
      return "success";
    case "busy":
      return "warn";
    case "overloaded":
      return "error";
    case "unknown":
      return "warn";
  }
}

function evidenceRole(
  status: SupervisionLoadReport["evidence"][number]["status"],
): "success" | "warn" | "error" {
  switch (status) {
    case "available":
      return "success";
    case "missing":
      return "warn";
    case "unreadable":
      return "error";
  }
}

function referenceRole(
  kind: SupervisionLoadReport["topReferences"][number]["kind"],
): "warn" | "error" | "info" | "muted" {
  switch (kind) {
    case "approval":
    case "owner-question":
    case "task-claim":
      return "warn";
    case "dead-letter":
      return "error";
    case "active-run":
    case "attention-item":
      return "info";
    case "post-completion-follow-up":
      return "muted";
  }
}
