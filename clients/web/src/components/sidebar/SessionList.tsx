import { sessionsQuery } from "@/api/queries";
import { AutonomyModeBadge } from "@/components/autonomy/AutonomyModeControl";
import { useProjectId } from "@/lib/project-context";
import { useQuery } from "@tanstack/react-query";

export function SessionList({
  activeSessionId,
  onSelect,
}: {
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}) {
  const projectId = useProjectId();
  const { data } = useQuery(sessionsQuery(projectId));
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
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent ${
            activeSessionId === s.id ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          <AutonomyModeBadge mode={s.autonomyMode} />
          <span className="truncate">{s.id.slice(0, 12)}...</span>
        </button>
      ))}
    </div>
  );
}
