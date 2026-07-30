import { apiFetch, apiJson, withProject } from "./client-runtime";
import type {
  ConversationData,
  ConversationRecord,
  DaemonLiveStatus,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./types";

export const workflowApi = {
  getDaemonStatus: (projectId: string) =>
    apiJson<{ daemon: DaemonLiveStatus | null }>(
      withProject("/api/daemon/status", projectId),
    ),
  getWorkflowStatus: (projectId: string) =>
    apiJson<WorkflowLiveStatus>(withProject("/api/workflow/status", projectId)),
  getWorkflowDefinitions: (projectId: string) =>
    apiJson<{ definitions: WorkflowDefinitionSummary[] }>(
      withProject("/api/workflow/definitions", projectId),
    ),
  enableWorkflow: (name: string, projectId: string) =>
    apiJson<{ ok: boolean }>(
      withProject(
        `/api/workflow/definitions/${encodeURIComponent(name)}/enable`,
        projectId,
      ),
      { method: "POST" },
    ),
  disableWorkflow: (name: string, projectId: string) =>
    apiJson<{ ok: boolean }>(
      withProject(
        `/api/workflow/definitions/${encodeURIComponent(name)}/disable`,
        projectId,
      ),
      { method: "POST" },
    ),
  pauseWorkflow: (projectId: string) =>
    apiJson<{ already: boolean }>(
      withProject("/api/workflow/pause", projectId),
      { method: "POST" },
    ),
  resumeWorkflow: (projectId: string) =>
    apiJson<{ already: boolean }>(
      withProject("/api/workflow/resume", projectId),
      { method: "POST" },
    ),
  abortWorkflows: (projectId: string) =>
    apiJson<{ aborted: number }>(
      withProject("/api/workflow/abort", projectId),
      { method: "POST" },
    ),
  triggerWorkflow: (
    name: string,
    projectId: string,
    payload?: Record<string, unknown>,
  ) =>
    apiJson<{ ok: boolean }>(withProject("/api/workflow/trigger", projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    }),
  listWorkflowRuns: (
    projectId: string,
    params?: {
      limit?: number;
      offset?: number;
      workflow?: string;
      tag?: string;
    },
  ) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    if (params?.workflow) search.set("workflow", params.workflow);
    if (params?.tag) search.set("tag", params.tag);
    const query = search.toString();
    return apiJson<{ runs: WorkflowRunSummary[] }>(
      withProject(`/api/workflow/runs${query ? `?${query}` : ""}`, projectId),
    );
  },
  getWorkflowRun: (id: string, projectId: string) =>
    apiJson<WorkflowRunDetail>(
      withProject(`/api/workflow/runs/${encodeURIComponent(id)}`, projectId),
    ),
  cancelWorkflowRun: (id: string, projectId: string) =>
    apiJson<{ ok: boolean }>(
      withProject(`/api/workflow/runs/${encodeURIComponent(id)}`, projectId),
      { method: "DELETE" },
    ),
  abortWorkflowRun: (id: string, projectId: string) =>
    apiJson<{ ok: boolean }>(
      withProject(
        `/api/workflow/runs/${encodeURIComponent(id)}/abort`,
        projectId,
      ),
      { method: "POST" },
    ),
  retryWorkflowRun: (runId: string, projectId: string) =>
    apiJson<{ ok: boolean }>(withProject("/api/workflow/retry", projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    }),
  listHistory: (params?: { search?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.search) search.set("search", params.search);
    if (params?.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    return apiJson<{ conversations: ConversationRecord[] }>(
      `/api/history${query ? `?${query}` : ""}`,
    );
  },
  getHistory: (id: string) =>
    apiJson<ConversationData>(`/api/history/${encodeURIComponent(id)}`),
  deleteHistory: (id: string) =>
    apiFetch(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
