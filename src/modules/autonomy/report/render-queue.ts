import {
  blank,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type { QueueBalance } from "./aggregate.js";
import {
  pct,
  priorityLabel,
  priorityRole,
} from "./render-common.js";

export function renderQueueBalance(balance: QueueBalance): RenderNode[] {
  if (balance.total === 0) {
    return [line(span("(none)", "muted"))];
  }
  const priorityEntries: KVEntry[] = balance.byPriority.map((p) => ({
    label: priorityLabel(p.priority),
    value: `${p.count} (${pct(p.count, balance.total)})`,
    role: priorityRole(p.priority),
  }));
  const stateEntries: KVEntry[] = balance.byState.map((s) => ({
    label: s.state,
    value: `${s.count}`,
  }));
  const lines: RenderNode[] = [
    line(plain("Total: "), span(String(balance.total), "accent")),
    blank(),
    line(span("By state", "muted", true)),
    kvBlock(stateEntries, 12),
    blank(),
    line(span("By priority", "muted", true)),
    kvBlock(priorityEntries, 12),
  ];
  if (balance.waitingOnTasks.length > 0) {
    lines.push(blank());
    lines.push(line(span("Waiting on tasks", "muted", true)));
    for (const wait of balance.waitingOnTasks) {
      lines.push(line(
        plain("  "),
        span(wait.taskId, "warn"),
        plain(` (${wait.state}) -> `),
        plain(wait.waitingOn.join(", ")),
      ));
    }
  }
  return lines;
}
