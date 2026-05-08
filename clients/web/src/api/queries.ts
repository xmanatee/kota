import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Query-key factories for the web client. Project-scoped keys take a
 * `projectId` first so the TanStack Query cache cannot leak rows from
 * one project into another. Switching the active project simply changes
 * the projectId and React Query treats it as a fresh query.
 *
 * Truly global keys (`identity`, `health`, `slashCommands`, free-form
 * `historyDetail`) stay primitive — those endpoints describe the daemon
 * itself or content addressed by an opaque id, not project-scoped state.
 */
export const queryKeys = {
  identity: ["identity"] as const,
  health: ["health"] as const,
  daemonStatus: (projectId: string) => ["daemonStatus", projectId] as const,
  workflowStatus: (projectId: string) => ["workflowStatus", projectId] as const,
  workflowDefinitions: (projectId: string) =>
    ["workflowDefinitions", projectId] as const,
  workflowRuns: (
    projectId: string,
    params?: { limit?: number; offset?: number },
  ) => ["workflowRuns", projectId, params] as const,
  workflowRun: (id: string, projectId: string) =>
    ["workflowRun", projectId, id] as const,
  history: (params?: { search?: string; limit?: number }) =>
    ["history", params] as const,
  historyDetail: (id: string) => ["historyDetail", id] as const,
  approvals: (projectId: string) => ["approvals", projectId] as const,
  ownerQuestions: (projectId: string) => ["ownerQuestions", projectId] as const,
  tasks: (projectId: string) => ["tasks", projectId] as const,
  sessions: (projectId: string) => ["sessions", projectId] as const,
  schedules: (projectId: string) => ["schedules", projectId] as const,
  modules: (projectId: string) => ["modules", projectId] as const,
  memory: (projectId: string) => ["memory", projectId] as const,
  audit: (projectId: string) => ["audit", projectId] as const,
  config: (projectId: string) => ["config", projectId] as const,
  slashCommands: ["slashCommands"] as const,
  digest: (projectId: string) => ["digest", projectId] as const,
  attention: (projectId: string) => ["attention", projectId] as const,
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

export function daemonStatusQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.daemonStatus(projectId),
    queryFn: () => api.getDaemonStatus(projectId),
    refetchInterval: 60000,
    enabled: projectId !== "",
  });
}

export function workflowStatusQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowStatus(projectId),
    queryFn: () => api.getWorkflowStatus(projectId),
    refetchInterval: 30000,
    enabled: projectId !== "",
  });
}

export function workflowDefinitionsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowDefinitions(projectId),
    queryFn: () => api.getWorkflowDefinitions(projectId),
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function workflowRunsQuery(
  projectId: string,
  params?: { limit?: number; offset?: number },
) {
  return queryOptions({
    queryKey: queryKeys.workflowRuns(projectId, params),
    queryFn: () => api.listWorkflowRuns(projectId, params),
    refetchInterval: 30000,
    enabled: projectId !== "",
  });
}

export function workflowRunQuery(id: string, projectId: string) {
  return queryOptions({
    queryKey: queryKeys.workflowRun(id, projectId),
    queryFn: () => api.getWorkflowRun(id, projectId),
    enabled: projectId !== "",
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

export function approvalsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.approvals(projectId),
    queryFn: api.listApprovals,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function ownerQuestionsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.ownerQuestions(projectId),
    queryFn: api.listOwnerQuestions,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function tasksQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.tasks(projectId),
    queryFn: api.getTasks,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function sessionsQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.sessions(projectId),
    queryFn: () => api.listSessions(projectId),
    refetchInterval: 15000,
    enabled: projectId !== "",
  });
}

export function schedulesQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.schedules(projectId),
    queryFn: api.getSchedules,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function modulesQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.modules(projectId),
    queryFn: api.getModules,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function memoryQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.memory(projectId),
    queryFn: api.getMemory,
    enabled: projectId !== "",
  });
}

export function auditQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.audit(projectId),
    queryFn: api.getAudit,
    enabled: projectId !== "",
  });
}

export function configQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.config(projectId),
    queryFn: api.getConfig,
    enabled: projectId !== "",
  });
}

export const slashCommandsQuery = queryOptions({
  queryKey: queryKeys.slashCommands,
  queryFn: api.listSlashCommands,
  refetchInterval: 60000,
});

export function digestQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.digest(projectId),
    queryFn: api.getDigest,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}

export function attentionQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.attention(projectId),
    queryFn: api.getAttention,
    refetchInterval: 300000,
    enabled: projectId !== "",
  });
}
