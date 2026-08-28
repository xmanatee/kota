import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const queryKeys = {
  sessions: (scopeId: string) => ["sessions", scopeId] as const,
  uiSurfaces: (scopeId: string) => ["uiSurfaces", scopeId] as const,
};

export function sessionsQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.sessions(scopeId),
    queryFn: () => api.listSessions(scopeId),
    refetchInterval: 15_000,
    enabled: scopeId !== "",
  });
}

export const slashCommandsQuery = queryOptions({
  queryKey: ["slashCommands"] as const,
  queryFn: api.listSlashCommands,
  staleTime: 60_000,
});

export function uiSurfacesQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.uiSurfaces(scopeId),
    queryFn: () => api.getUiSurfaces(scopeId),
    enabled: scopeId !== "",
  });
}
