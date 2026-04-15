import { sessionsQuery } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";

export function SessionList({
  activeSessionId,
  onSelect,
}: {
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data } = useQuery(sessionsQuery);
  const sessions = data?.sessions ?? [];

  if (sessions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No active sessions</div>
    );
  }

  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          className={`w-full truncate rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent ${
            activeSessionId === s.id ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          {s.id.slice(0, 12)}...
        </button>
      ))}
    </div>
  );
}
