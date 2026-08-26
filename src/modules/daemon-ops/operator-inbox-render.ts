import {
  blank,
  heading,
  line,
  list,
  plain,
  type RenderNode,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { OperatorInboxKind, OperatorInboxSnapshot } from "./operator-inbox.js";

function age(createdAt: string | undefined): string {
  if (!createdAt) return "";
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ms / 86_400_000);
  return `${days}d ago`;
}

function kindLabel(kind: OperatorInboxKind): string {
  switch (kind) {
    case "runtime":
      return "runtime";
    case "approval":
      return "approval";
    case "setup":
      return "setup";
    case "owner-question":
      return "owner question";
    case "blocked-task":
      return "blocked task";
    case "failed-run":
      return "failed run";
  }
}

export function buildOperatorInboxNode(snapshot: OperatorInboxSnapshot): RenderNode {
  if (snapshot.items.length === 0) {
    return stack(
      statusBanner("success", "Operator inbox is clear", snapshot.scopeRoot),
      line(span("No approvals, owner questions, blocked owner asks, setup gaps, failed runs, or runtime warnings.", "muted")),
    );
  }

  const summary = Object.entries(snapshot.counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kindLabel(kind as OperatorInboxKind)}${count === 1 ? "" : "s"}`)
    .join(", ");

  return stack(
    heading("Operator inbox", 1),
    line(span(summary, "accent", true)),
    line(span(snapshot.scopeRoot, "muted")),
    blank(),
    list(snapshot.items.map((item) => ({
      spans: [
        span(`[${kindLabel(item.kind)}] `, item.role, true),
        span(item.title, item.role),
        ...(item.createdAt ? [span(`  ${age(item.createdAt)}`, "muted" as const)] : []),
      ],
      children: [
        line(span("Detail: ", "muted"), plain(item.detail)),
        line(span("Action: ", "muted"), plain(item.action)),
      ],
    }))),
  );
}

export function formatOperatorInboxOutput(snapshot: OperatorInboxSnapshot): string {
  return renderToString(buildOperatorInboxNode(snapshot));
}
