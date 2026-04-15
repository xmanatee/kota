import type {
  AuditEntry,
  ConversationData,
  ConversationRecord,
  DaemonLiveStatus,
  DaemonTaskStatusResponse,
  HealthStatus,
  KnowledgeEntry,
  MemoryEntry,
  ModuleInfo,
  PendingApproval,
  ScheduleEntry,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./types";

function getAuthToken(): string {
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    localStorage.setItem("kota-auth-token", urlToken);
    history.replaceState(null, "", window.location.pathname);
    return urlToken;
  }
  return localStorage.getItem("kota-auth-token") ?? "";
}

let cachedToken = getAuthToken();

function authHeaders(): Record<string, string> {
  if (!cachedToken) cachedToken = getAuthToken();
  return cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {};
}

async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
  });
}

async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => apiJson<HealthStatus>("/api/health"),

  getDaemonStatus: () =>
    apiJson<{ daemon: DaemonLiveStatus | null }>("/api/daemon/status"),

  getWorkflowStatus: () => apiJson<WorkflowLiveStatus>("/api/workflow/status"),

  getWorkflowDefinitions: () =>
    apiJson<{ definitions: WorkflowDefinitionSummary[] }>(
      "/api/workflow/definitions",
    ),

  enableWorkflow: (name: string) =>
    apiJson<{ ok: boolean }>(
      `/api/workflow/definitions/${encodeURIComponent(name)}/enable`,
      { method: "POST" },
    ),

  disableWorkflow: (name: string) =>
    apiJson<{ ok: boolean }>(
      `/api/workflow/definitions/${encodeURIComponent(name)}/disable`,
      { method: "POST" },
    ),

  pauseWorkflow: () =>
    apiJson<{ already: boolean }>("/api/workflow/pause", { method: "POST" }),

  resumeWorkflow: () =>
    apiJson<{ already: boolean }>("/api/workflow/resume", { method: "POST" }),

  abortWorkflows: () =>
    apiJson<{ aborted: number }>("/api/workflow/abort", { method: "POST" }),

  triggerWorkflow: (name: string, payload?: Record<string, unknown>) =>
    apiJson<{ ok: boolean }>("/api/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    }),

  listWorkflowRuns: (params?: {
    limit?: number;
    offset?: number;
    workflow?: string;
    tag?: string;
  }) => {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.offset) search.set("offset", String(params.offset));
    if (params?.workflow) search.set("workflow", params.workflow);
    if (params?.tag) search.set("tag", params.tag);
    const qs = search.toString();
    return apiJson<{ runs: WorkflowRunSummary[] }>(
      `/api/workflow/runs${qs ? `?${qs}` : ""}`,
    );
  },

  getWorkflowRun: (id: string) =>
    apiJson<WorkflowRunDetail>(`/api/workflow/runs/${encodeURIComponent(id)}`),

  cancelWorkflowRun: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/workflow/runs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  abortWorkflowRun: (id: string) =>
    apiJson<{ ok: boolean }>(
      `/api/workflow/runs/${encodeURIComponent(id)}/abort`,
      { method: "POST" },
    ),

  retryWorkflowRun: (runId: string) =>
    apiJson<{ ok: boolean }>("/api/workflow/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    }),

  listHistory: (params?: { search?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.search) search.set("search", params.search);
    if (params?.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return apiJson<{ conversations: ConversationRecord[] }>(
      `/api/history${qs ? `?${qs}` : ""}`,
    );
  },

  getHistory: (id: string) =>
    apiJson<ConversationData>(`/api/history/${encodeURIComponent(id)}`),

  deleteHistory: (id: string) =>
    apiFetch(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listApprovals: () =>
    apiJson<{ approvals: PendingApproval[] }>("/api/approvals"),

  approveApproval: (id: string, note?: string) =>
    apiJson<PendingApproval>(
      `/api/approvals/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      },
    ),

  rejectApproval: (id: string, reason?: string) =>
    apiJson<PendingApproval>(
      `/api/approvals/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ),

  approveAll: (note?: string) =>
    apiJson<PendingApproval[]>("/api/approvals/approve-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }),

  rejectAll: (reason?: string) =>
    apiJson<PendingApproval[]>("/api/approvals/reject-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),

  getTasks: () => apiJson<DaemonTaskStatusResponse>("/api/tasks"),

  createTask: (title: string, summary: string) =>
    apiJson<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, summary }),
    }),

  moveTask: (id: string, state: string) =>
    apiJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}/state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }),

  updateTaskBody: (id: string, body: string) =>
    apiJson<{ body: string }>(`/api/tasks/${encodeURIComponent(id)}/body`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }),

  listSessions: () =>
    apiJson<{
      sessions: Array<{ id: string; createdAt: string; lastActive: number }>;
    }>("/api/sessions"),

  createSession: () =>
    apiJson<{ session_id: string }>("/api/sessions", { method: "POST" }),

  deleteSession: (id: string) =>
    apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  chat: (message: string, sessionId: string) =>
    apiFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId }),
    }),

  getSchedules: () => apiJson<{ schedules: ScheduleEntry[] }>("/api/schedules"),

  getModules: () => apiJson<{ modules: ModuleInfo[] }>("/api/modules"),

  getKnowledge: () => apiJson<{ entries: KnowledgeEntry[] }>("/api/knowledge"),

  getMemory: () => apiJson<{ entries: MemoryEntry[] }>("/api/memory"),

  getAudit: () => apiJson<{ entries: AuditEntry[] }>("/api/audit"),

  getConfig: () => apiJson<Record<string, unknown>>("/api/config"),
};

export { apiFetch, getAuthToken };
