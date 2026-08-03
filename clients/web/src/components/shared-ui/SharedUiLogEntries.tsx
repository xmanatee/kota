import { cn } from "@/lib/utils";
import type { UiLogEntry } from "../../../../conformance/ui-surface.generated";
import { roleClass } from "./ui-render-utils";

export function SharedUiLogEntries({
  entries,
}: {
  entries: readonly UiLogEntry[];
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No log entries.</p>;
  }
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-md border border-border bg-muted/20 font-mono text-xs">
      {entries.map((entry, index) => (
        <li
          key={`${entry.timestamp}-${index}`}
          className="grid gap-1 px-3 py-2 sm:grid-cols-[auto_auto_1fr] sm:gap-3"
          data-level={entry.level}
        >
          <time className="text-muted-foreground">{entry.timestamp}</time>
          <span
            className={cn(
              "font-semibold uppercase",
              roleClass(entry.level === "debug" ? "muted" : entry.level),
            )}
          >
            {entry.level}
          </span>
          <span className="min-w-0 break-words">
            {entry.source ? (
              <span className="text-muted-foreground">{entry.source}: </span>
            ) : null}
            {entry.message}
          </span>
        </li>
      ))}
    </ol>
  );
}
