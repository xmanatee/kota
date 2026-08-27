import { apiFetch, apiJson, withScope } from "./client-runtime";
import type {
  AuditEntry,
  AutonomyMode,
  DaemonTaskStatusResponse,
  InteractiveSession,
  MemoryEntry,
  ModuleInfo,
  PendingApproval,
  PendingOwnerQuestion,
  ScheduleEntry,
} from "./types";

export const operatorApi = {
  listApprovals: (scopeId: string) =>
    apiJson<{ approvals: PendingApproval[] }>(
      withScope("/api/approvals", scopeId),
    ),
  approveApproval: (
    scopeId: string,
    id: string,
    reviewDigest: string,
    note?: string,
  ) =>
    apiJson<PendingApproval>(
      withScope(`/api/approvals/${encodeURIComponent(id)}/approve`, scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewDigest, note }),
      },
    ),
  rejectApproval: (scopeId: string, id: string, reason?: string) =>
    apiJson<PendingApproval>(
      withScope(`/api/approvals/${encodeURIComponent(id)}/reject`, scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ),
  approveAll: (
    scopeId: string,
    reviews: Array<{ id: string; digest: string }>,
    note?: string,
  ) =>
    apiJson<PendingApproval[]>(
      withScope("/api/approvals/approve-all", scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews, note }),
      },
    ),
  rejectAll: (scopeId: string, reason?: string) =>
    apiJson<PendingApproval[]>(
      withScope("/api/approvals/reject-all", scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    ),
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
  createTask: (title: string, priority: "p0" | "p1" | "p2" | "p3" = "p2") =>
    apiJson<{ id: string }>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, priority }),
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
  listSessions: (scopeId: string) =>
    apiJson<{ sessions: InteractiveSession[] }>(
      withScope("/api/sessions", scopeId),
    ),
  createSession: (scopeId: string, autonomyMode?: AutonomyMode) =>
    apiJson<{ session_id: string; autonomy_mode?: AutonomyMode }>(
      withScope("/api/sessions", scopeId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          autonomyMode ? { autonomy_mode: autonomyMode } : {},
        ),
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
  chat: (message: string, sessionId: string) =>
    apiFetch("/api/chat", {
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
