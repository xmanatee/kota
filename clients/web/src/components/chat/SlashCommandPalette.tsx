import type { SlashCommand } from "@/api/types";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  commands: SlashCommand[];
  query: string;
  onPick: (cmd: SlashCommand) => void;
  onDismiss: () => void;
};

function filterCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q),
  );
}

export function SlashCommandPalette({
  commands,
  query,
  onPick,
  onDismiss,
}: Props) {
  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );
  const [selected, setSelected] = useState(0);
  const [trackedQuery, setTrackedQuery] = useState(query);
  const containerRef = useRef<HTMLDivElement>(null);

  if (trackedQuery !== query) {
    setTrackedQuery(query);
    setSelected(0);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        const pick = filtered[selected];
        if (!pick) return;
        e.preventDefault();
        onPick(pick);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, selected, onPick, onDismiss]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 mb-2 max-h-72 w-96 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
      // biome-ignore lint/a11y/useSemanticElements: native <select>/<option> cannot host the rich layout (label, source, description rows) and custom keyboard nav this command palette renders; ARIA listbox+option is the W3C combobox/listbox pattern for this case.
      role="listbox"
      aria-label="Slash command palette"
      tabIndex={-1}
    >
      {filtered.map((cmd, i) => (
        <button
          type="button"
          key={cmd.name}
          // biome-ignore lint/a11y/useSemanticElements: paired with the listbox above; native <option> cannot render the label/source/description rows.
          role="option"
          aria-selected={i === selected}
          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
            i === selected
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted"
          }`}
          onMouseEnter={() => setSelected(i)}
          onClick={() => onPick(cmd)}
        >
          <div className="flex w-full items-baseline justify-between gap-2">
            <span className="font-mono">{cmd.label}</span>
            <span className="text-xs text-muted-foreground">
              {cmd.source} · {cmd.module}
            </span>
          </div>
          {cmd.description ? (
            <span className="text-xs text-muted-foreground">
              {cmd.description}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
