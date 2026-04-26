/**
 * Renders aggregated digest data through the rendering module's primitives so
 * Telegram, Slack, email, and webhook surfaces all receive the same
 * deterministic body without channel-specific branching here.
 */

import {
  blank,
  heading,
  type ListItem,
  list,
  NO_COLOR_THEME,
  plain,
  type RenderNode,
  render,
  sectionRule,
  span,
  stack,
} from "#modules/rendering/index.js";
import type { DailyDigestData, QueueDelta } from "./aggregate.js";

/**
 * Renders the digest body to a plain text string suitable for chat surfaces.
 * Uses the no-color theme so Telegram/Slack/email/webhook payloads do not
 * contain ANSI escape codes that would render as garbage on those channels.
 */
export function renderDailyDigest(data: DailyDigestData): string {
  return render(buildDailyDigestNode(data), {
    width: 80,
    theme: NO_COLOR_THEME,
  });
}

export function buildDailyDigestNode(data: DailyDigestData): RenderNode {
  const titleLine = `Daily digest (${formatWindowLabel(data.windowStartedAt, data.windowEndedAt)})`;
  if (data.quiet) {
    return stack(
      heading(titleLine, 1),
      blank(),
      { kind: "line", spans: [span("No autonomy activity in this window.", "muted")] },
      blank(),
      ...queueDeltaSection(data.queueDelta),
    );
  }

  const sections: RenderNode[] = [
    heading(titleLine, 1),
    blank(),
    ...builderSection(data.builderCommits),
    ...explorerSection(data.explorerAdditions),
    ...decomposerSection(data.decomposerSplits),
    ...blockedPromoterSection(data.blockedPromoterMoves),
    ...failuresSection(data.failedMonitoredRuns),
    ...ownerQuestionsSection(data.pendingOwnerQuestions),
    ...operatorCaptureSection(data.agingOperatorCaptures),
    ...queueDeltaSection(data.queueDelta),
  ];
  return stack(...sections);
}

function formatWindowLabel(startedAt: string, endedAt: string): string {
  return `${shortIso(startedAt)} → ${shortIso(endedAt)}`;
}

function shortIso(iso: string): string {
  return iso.replace(/:\d{2}\.\d{3}Z$/, "Z").replace("T", " ");
}

function builderSection(items: DailyDigestData["builderCommits"]): RenderNode[] {
  if (items.length === 0) return [];
  const totalDuration = items.reduce(
    (sum, i) => sum + (i.durationMs ?? 0),
    0,
  );
  const label = `Builder commits (${items.length}${totalDuration > 0 ? `, ${formatDuration(totalDuration)} total` : ""})`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(item.taskId ? `${item.taskId}` : item.runId),
      span(`: ${item.commitSubject || "(no subject)"}`, "neutral"),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function explorerSection(
  items: DailyDigestData["explorerAdditions"],
): RenderNode[] {
  if (items.length === 0) return [];
  const taskTotal = items.reduce((sum, i) => sum + i.taskCount, 0);
  const watchTotal = items.reduce((sum, i) => sum + i.watchlistAdds, 0);
  const label = `Explorer additions (${items.length} run${items.length === 1 ? "" : "s"}, ${taskTotal} task batch${taskTotal === 1 ? "" : "es"}, ${watchTotal} watchlist add${watchTotal === 1 ? "" : "s"})`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(item.runId),
      span(
        `: +${item.taskCount} tasks, +${item.watchlistAdds} watchlist`,
        "neutral",
      ),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function decomposerSection(
  items: DailyDigestData["decomposerSplits"],
): RenderNode[] {
  if (items.length === 0) return [];
  const label = `Decomposer splits (${items.length})`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(item.parentTaskId ?? item.runId),
      span(
        ` → ${item.childTaskCount} child task${item.childTaskCount === 1 ? "" : "s"}`,
        "neutral",
      ),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function blockedPromoterSection(
  items: DailyDigestData["blockedPromoterMoves"],
): RenderNode[] {
  if (items.length === 0) return [];
  const totalPromoted = items.reduce(
    (sum, i) => sum + i.promotedTaskIds.length,
    0,
  );
  const label = `Blocked-promoter moves (${totalPromoted} task${totalPromoted === 1 ? "" : "s"} promoted across ${items.length} run${items.length === 1 ? "" : "s"})`;
  const rows: ListItem[] = items.flatMap((item) => [
    ...item.toReady.map((id) => ({
      spans: [plain(id), span(": blocked → ready", "success")],
    })),
    ...item.toBacklog.map((id) => ({
      spans: [plain(id), span(": blocked → backlog", "info")],
    })),
  ]);
  return [sectionRule(label), list(rows), blank()];
}

function failuresSection(
  items: DailyDigestData["failedMonitoredRuns"],
): RenderNode[] {
  if (items.length === 0) return [];
  const label = `Failed/interrupted monitored runs (${items.length}) — see attention-digest`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(`${item.workflow}`),
      span(`: ${item.status} (${item.runId})`, "error"),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function ownerQuestionsSection(
  items: DailyDigestData["pendingOwnerQuestions"],
): RenderNode[] {
  if (items.length === 0) return [];
  const label = `Pending owner questions (${items.length})`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(`${item.id}`),
      span(
        ` (${item.source}, ${item.ageDays}d): ${truncate(item.question, 80)}`,
        "warn",
      ),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function operatorCaptureSection(
  items: DailyDigestData["agingOperatorCaptures"],
): RenderNode[] {
  if (items.length === 0) return [];
  const label = `Aging operator-capture preconditions (${items.length})`;
  const rows: ListItem[] = items.map((item) => ({
    spans: [
      plain(item.taskId),
      span(` (${item.ageDays}d, awaits ${item.path})`, "warn"),
    ],
  }));
  return [sectionRule(label), list(rows), blank()];
}

function queueDeltaSection(delta: QueueDelta): RenderNode[] {
  const rows: ListItem[] = (
    ["ready", "backlog", "doing", "blocked"] as const
  ).map((key) => {
    const current = delta.current[key];
    const change = delta.delta[key];
    const changeLabel =
      change == null
        ? " (no prior snapshot)"
        : change === 0
          ? " (=)"
          : ` (${change > 0 ? "+" : ""}${change})`;
    return {
      spans: [plain(`${key}: ${current}`), span(changeLabel, "muted")],
    };
  });
  return [sectionRule("Queue state"), list(rows)];
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h${rem}m`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
