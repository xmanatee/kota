import { api } from "@/api/client";
import { queryKeys, sessionsQuery } from "@/api/queries";
import type { AutonomyMode } from "@/api/types";
import { AutonomyModeSelect } from "@/components/autonomy/AutonomyModeControl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function ActiveSessionsPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery(sessionsQuery);
  const sessions = data?.sessions ?? [];

  const setMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: AutonomyMode }) =>
      api.setSessionAutonomyMode(id, mode),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  });

  if (sessions.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">No active sessions</div>
    );
  }

  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <div key={s.id} className="space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="truncate">{s.id.slice(0, 16)}...</span>
            <span className="text-muted-foreground">
              {new Date(s.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <AutonomyModeSelect
            value={s.autonomyMode}
            disabled={setMode.isPending}
            onChange={(mode) => setMode.mutate({ id: s.id, mode })}
          />
        </div>
      ))}
    </div>
  );
}
