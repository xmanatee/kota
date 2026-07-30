import type {
  AutonomyMode,
  DaemonTaskStatusResponse,
  InteractiveSession,
  PendingApproval,
  PendingOwnerQuestion,
  ScheduleEntry,
  ModuleInfo,
  MemoryEntry,
  AuditEntry,
} from "./types";
import { apiFetch, apiJson, withProject } from "./client-runtime";

export const operatorApi = {
  listApprovals: (projectId: string) =>
    apiJson<{ approvals: PendingApproval[] }>(
      withProject("/api/approvals", projectId),
    ),
  approveApproval: (
    projectId: string,
    id: string,
    reviewDigest: string,
    note?: string,
  ) =>
    apiJson<PendingApproval>(withProject(
      `/api/approvals/${encodeURIComponent(id)}/approve`,
      projectId,
    ), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewDigest, note }),
    }),
  rejectApproval: (projectId: string, id: string, reason?: string) =>
    apiJson<PendingApproval>(withProject(
      `/api/approvals/${encodeURIComponent(id)}/reject`,
      projectId,
    ), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  approveAll: (
    projectId: string,
    reviews: Array<{ id: string; digest: string }>,
    note?: string,
  ) =>
    apiJson<PendingApproval[]>(withProject("/api/approvals/approve-all", projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviews, note }),
    }),
  rejectAll: (projectId: string, reason?: string) =>
    apiJson<PendingApproval[]>(withProject("/api/approvals/reject-all", projectId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  listOwnerQuestions: () =>
    apiJson<{ questions: PendingOwnerQuestion[] }>("/api/owner-questions"),
  answerOwnerQuestion: (id: string, answer: string) =>
    apiJson<{ question: PendingOwnerQuestion }>(
      `/api/owner-questions/${encodeURIComponent(id)}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      },
    ),
  dismissOwnerQuestion: (id: string, reason?: string) =>
    apiJson<{ question: PendingOwnerQuestion }>(
      `/api/owner-questions/${encodeURIComponent(id)}/dismiss`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ),
  getTasks: () => apiJson<DaemonTaskStatusResponse>("/api/tasks"),
  createTask: (title: string, summary: string) => apiJson<{ id: string }>("/api/tasks", {
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
  listSessions: (projectId: string) =>
    apiJson<{ sessions: InteractiveSession[] }>(withProject("/api/sessions", projectId)),
  createSession: (projectId: string, autonomyMode?: AutonomyMode) =>
    apiJson<{ session_id: string; autonomy_mode?: AutonomyMode }>(
      withProject("/api/sessions", projectId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(autonomyMode ? { autonomy_mode: autonomyMode } : {}),
      },
    ),
  setSessionAutonomyMode: (id: string, mode: AutonomyMode) =>
    apiJson<{
      session_id: string;
      autonomy_mode: AutonomyMode;
      source?: string;
      serveOwned?: boolean;
    }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autonomy_mode: mode }),
    }),
  deleteSession: (id: string) =>
    apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  chat: (message: string, sessionId: string) => apiFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  }),
  getSchedules: () => apiJson<{ schedules: ScheduleEntry[] }>("/api/schedules"),
  getModules: () => apiJson<{ modules: ModuleInfo[] }>("/api/modules"),
  getMemory: () => apiJson<{ entries: MemoryEntry[] }>("/api/memory"),
  getAudit: () => apiJson<{ entries: AuditEntry[] }>("/api/audit"),
  getConfig: () => apiJson<Record<string, unknown>>("/api/config"),
};
