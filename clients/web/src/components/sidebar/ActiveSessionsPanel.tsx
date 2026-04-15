import { sessionsQuery } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";

export function ActiveSessionsPanel() {
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
        <div key={s.id} className="flex items-center justify-between text-xs">
          <span className="truncate">{s.id.slice(0, 16)}...</span>
          <span className="text-muted-foreground">
            {new Date(s.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
