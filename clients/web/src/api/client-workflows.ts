import { apiFetch, apiJson, withScope } from "./client-runtime";
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
  getDaemonStatus: (scopeId: string) =>
    apiJson<{ daemon: DaemonLiveStatus | null }>(
      withScope("/api/daemon/status", scopeId),
    ),
  getWorkflowStatus: (scopeId: string) =>
    apiJson<WorkflowLiveStatus>(withScope("/api/workflow/status", scopeId)),
  getWorkflowDefinitions: (scopeId: string) =>
    apiJson<{ definitions: WorkflowDefinitionSummary[] }>(
      withScope("/api/workflow/definitions", scopeId),
    ),
  enableWorkflow: (name: string, scopeId: string) =>
    apiJson<{ ok: boolean }>(
      withScope(
        `/api/workflow/definitions/${encodeURIComponent(name)}/enable`,
        scopeId,
      ),
      { method: "POST" },
    ),
  disableWorkflow: (name: string, scopeId: string) =>
    apiJson<{ ok: boolean }>(
      withScope(
        `/api/workflow/definitions/${encodeURIComponent(name)}/disable`,
        scopeId,
      ),
      { method: "POST" },
    ),
  pauseWorkflow: (scopeId: string) =>
    apiJson<{ already: boolean }>(withScope("/api/workflow/pause", scopeId), {
      method: "POST",
    }),
  resumeWorkflow: (scopeId: string) =>
    apiJson<{ already: boolean }>(withScope("/api/workflow/resume", scopeId), {
      method: "POST",
    }),
  abortWorkflows: (scopeId: string) =>
    apiJson<{ aborted: number }>(withScope("/api/workflow/abort", scopeId), {
      method: "POST",
    }),
  triggerWorkflow: (
    name: string,
    scopeId: string,
    payload?: Record<string, unknown>,
  ) =>
    apiJson<{ ok: boolean }>(withScope("/api/workflow/trigger", scopeId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    }),
  listWorkflowRuns: (
    scopeId: string,
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
      withScope(`/api/workflow/runs${query ? `?${query}` : ""}`, scopeId),
    );
  },
  getWorkflowRun: (id: string, scopeId: string) =>
    apiJson<WorkflowRunDetail>(
      withScope(`/api/workflow/runs/${encodeURIComponent(id)}`, scopeId),
    ),
  cancelWorkflowRun: (id: string, scopeId: string) =>
    apiJson<{ ok: boolean }>(
      withScope(`/api/workflow/runs/${encodeURIComponent(id)}`, scopeId),
      { method: "DELETE" },
    ),
  abortWorkflowRun: (id: string, scopeId: string) =>
    apiJson<{ ok: boolean }>(
      withScope(`/api/workflow/runs/${encodeURIComponent(id)}/abort`, scopeId),
      { method: "POST" },
    ),
  retryWorkflowRun: (runId: string, scopeId: string) =>
    apiJson<{ ok: boolean }>(withScope("/api/workflow/retry", scopeId), {
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
