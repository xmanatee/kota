import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Query-key factories for the web client. Scope-scoped keys take a
 * `scopeId` first so the TanStack Query cache cannot leak rows from
 * one scope into another. Switching the active scope simply changes
 * the scopeId and React Query treats it as a fresh query.
 *
 * Truly global keys (`identity`, `health`, `slashCommands`, free-form
 * `historyDetail`) stay primitive — those endpoints describe the daemon
 * itself or content addressed by an opaque id, not scope-bound state.
 */
export const queryKeys = {
  identity: ["identity"] as const,
  health: ["health"] as const,
  daemonStatus: (scopeId: string) => ["daemonStatus", scopeId] as const,
  workflowStatus: (scopeId: string) => ["workflowStatus", scopeId] as const,
  workflowDefinitions: (scopeId: string) =>
    ["workflowDefinitions", scopeId] as const,
  workflowRuns: (
    scopeId: string,
    params?: { limit?: number; offset?: number },
  ) => ["workflowRuns", scopeId, params] as const,
  workflowRun: (id: string, scopeId: string) =>
    ["workflowRun", scopeId, id] as const,
  history: (params?: { search?: string; limit?: number }) =>
    ["history", params] as const,
  historyDetail: (id: string) => ["historyDetail", id] as const,
  approvals: (scopeId: string) => ["approvals", scopeId] as const,
  ownerQuestions: (scopeId: string) => ["ownerQuestions", scopeId] as const,
  tasks: (scopeId: string) => ["tasks", scopeId] as const,
  sessions: (scopeId: string) => ["sessions", scopeId] as const,
  schedules: (scopeId: string) => ["schedules", scopeId] as const,
  modules: (scopeId: string) => ["modules", scopeId] as const,
  memory: (scopeId: string) => ["memory", scopeId] as const,
  audit: (scopeId: string) => ["audit", scopeId] as const,
  config: (scopeId: string) => ["config", scopeId] as const,
  slashCommands: ["slashCommands"] as const,
  digest: (scopeId: string) => ["digest", scopeId] as const,
  attention: (scopeId: string) => ["attention", scopeId] as const,
  uiSurfaces: (scopeId: string) => ["uiSurfaces", scopeId] as const,
};

export const identityQuery = queryOptions({
  queryKey: queryKeys.identity,
  queryFn: api.getIdentity,
  staleTime: 60_000,
});

export const healthQuery = queryOptions({
  queryKey: queryKeys.health,
  queryFn: api.getHealth,
  refetchInterval: 30000,
});

export function daemonStatusQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.daemonStatus(scopeId),
    queryFn: () => api.getDaemonStatus(scopeId),
    refetchInterval: 60000,
    enabled: scopeId !== "",
  });
}

export function workflowStatusQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowStatus(scopeId),
    queryFn: () => api.getWorkflowStatus(scopeId),
    refetchInterval: 30000,
    enabled: scopeId !== "",
  });
}

export function workflowDefinitionsQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowDefinitions(scopeId),
    queryFn: () => api.getWorkflowDefinitions(scopeId),
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function workflowRunsQuery(
  scopeId: string,
  params?: { limit?: number; offset?: number },
) {
  return queryOptions({
    queryKey: queryKeys.workflowRuns(scopeId, params),
    queryFn: () => api.listWorkflowRuns(scopeId, params),
    refetchInterval: 30000,
    enabled: scopeId !== "",
  });
}

export function workflowRunQuery(id: string, scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowRun(id, scopeId),
    queryFn: () => api.getWorkflowRun(id, scopeId),
    enabled: scopeId !== "",
  });
}

export function historyQuery(params?: { search?: string; limit?: number }) {
  return queryOptions({
    queryKey: queryKeys.history(params),
    queryFn: () => api.listHistory(params),
  });
}

export function historyDetailQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.historyDetail(id),
    queryFn: () => api.getHistory(id),
    enabled: !!id,
  });
}

export function approvalsQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.approvals(scopeId),
    queryFn: () => api.listApprovals(scopeId),
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function ownerQuestionsQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.ownerQuestions(scopeId),
    queryFn: api.listOwnerQuestions,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function tasksQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.tasks(scopeId),
    queryFn: api.getTasks,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function sessionsQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.sessions(scopeId),
    queryFn: () => api.listSessions(scopeId),
    refetchInterval: 15000,
    enabled: scopeId !== "",
  });
}

export function schedulesQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.schedules(scopeId),
    queryFn: api.getSchedules,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function modulesQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.modules(scopeId),
    queryFn: api.getModules,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function memoryQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.memory(scopeId),
    queryFn: api.getMemory,
    enabled: scopeId !== "",
  });
}

export function auditQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.audit(scopeId),
    queryFn: api.getAudit,
    enabled: scopeId !== "",
  });
}

export function configQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.config(scopeId),
    queryFn: api.getConfig,
    enabled: scopeId !== "",
  });
}

export const slashCommandsQuery = queryOptions({
  queryKey: queryKeys.slashCommands,
  queryFn: api.listSlashCommands,
  refetchInterval: 60000,
});

export function digestQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.digest(scopeId),
    queryFn: api.getDigest,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function attentionQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.attention(scopeId),
    queryFn: api.getAttention,
    refetchInterval: 300000,
    enabled: scopeId !== "",
  });
}

export function uiSurfacesQuery(scopeId: string) {
  return queryOptions({
    queryKey: queryKeys.uiSurfaces(scopeId),
    queryFn: () => api.getUiSurfaces(scopeId),
    enabled: scopeId !== "",
  });
}
