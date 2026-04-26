import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const queryKeys = {
  health: ["health"] as const,
  daemonStatus: ["daemonStatus"] as const,
  workflowStatus: ["workflowStatus"] as const,
  workflowDefinitions: ["workflowDefinitions"] as const,
  workflowRuns: (params?: { limit?: number; offset?: number }) =>
    ["workflowRuns", params] as const,
  workflowRun: (id: string) => ["workflowRun", id] as const,
  history: (params?: { search?: string; limit?: number }) =>
    ["history", params] as const,
  historyDetail: (id: string) => ["historyDetail", id] as const,
  approvals: ["approvals"] as const,
  ownerQuestions: ["ownerQuestions"] as const,
  tasks: ["tasks"] as const,
  sessions: ["sessions"] as const,
  schedules: ["schedules"] as const,
  modules: ["modules"] as const,
  knowledge: ["knowledge"] as const,
  memory: ["memory"] as const,
  audit: ["audit"] as const,
  config: ["config"] as const,
  slashCommands: ["slashCommands"] as const,
  digest: ["digest"] as const,
};

export const healthQuery = queryOptions({
  queryKey: queryKeys.health,
  queryFn: api.getHealth,
  refetchInterval: 30000,
});

export const daemonStatusQuery = queryOptions({
  queryKey: queryKeys.daemonStatus,
  queryFn: api.getDaemonStatus,
  refetchInterval: 60000,
});

export const workflowStatusQuery = queryOptions({
  queryKey: queryKeys.workflowStatus,
  queryFn: api.getWorkflowStatus,
  refetchInterval: 30000,
});

export const workflowDefinitionsQuery = queryOptions({
  queryKey: queryKeys.workflowDefinitions,
  queryFn: api.getWorkflowDefinitions,
  refetchInterval: 300000,
});

export function workflowRunsQuery(params?: {
  limit?: number;
  offset?: number;
}) {
  return queryOptions({
    queryKey: queryKeys.workflowRuns(params),
    queryFn: () => api.listWorkflowRuns(params),
    refetchInterval: 30000,
  });
}

export function workflowRunQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.workflowRun(id),
    queryFn: () => api.getWorkflowRun(id),
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

export const approvalsQuery = queryOptions({
  queryKey: queryKeys.approvals,
  queryFn: api.listApprovals,
  refetchInterval: 300000,
});

export const ownerQuestionsQuery = queryOptions({
  queryKey: queryKeys.ownerQuestions,
  queryFn: api.listOwnerQuestions,
  refetchInterval: 300000,
});

export const tasksQuery = queryOptions({
  queryKey: queryKeys.tasks,
  queryFn: api.getTasks,
  refetchInterval: 300000,
});

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: api.listSessions,
  refetchInterval: 15000,
});

export const schedulesQuery = queryOptions({
  queryKey: queryKeys.schedules,
  queryFn: api.getSchedules,
  refetchInterval: 300000,
});

export const modulesQuery = queryOptions({
  queryKey: queryKeys.modules,
  queryFn: api.getModules,
  refetchInterval: 300000,
});

export const knowledgeQuery = queryOptions({
  queryKey: queryKeys.knowledge,
  queryFn: api.getKnowledge,
});

export const memoryQuery = queryOptions({
  queryKey: queryKeys.memory,
  queryFn: api.getMemory,
});

export const auditQuery = queryOptions({
  queryKey: queryKeys.audit,
  queryFn: api.getAudit,
});

export const configQuery = queryOptions({
  queryKey: queryKeys.config,
  queryFn: api.getConfig,
});

export const slashCommandsQuery = queryOptions({
  queryKey: queryKeys.slashCommands,
  queryFn: api.listSlashCommands,
  refetchInterval: 60000,
});

export const digestQuery = queryOptions({
  queryKey: queryKeys.digest,
  queryFn: api.getDigest,
  refetchInterval: 300000,
});
