import {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
  parseAttentionResponse,
  parseCaptureResult,
  parseDigestResponse,
  parseHistorySearchResponse,
  parseKnowledgeSearchResponse,
  parseMemorySearchResponse,
  parseRecallResult,
  parseRetractResult,
  parseTasksSearchResponse,
} from "../../../conformance/decoders";
import type {
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
  AnswerResult,
  AttentionResponse,
  AuditEntry,
  AutonomyMode,
  CapabilityReadinessResponse,
  CaptureFilter,
  CaptureResult,
  ClientIdentity,
  ConversationData,
  ConversationRecord,
  DaemonLiveStatus,
  DaemonTaskStatusResponse,
  DigestResponse,
  HealthStatus,
  HistorySearchResponse,
  InteractiveSession,
  KnowledgeSearchResponse,
  MemoryEntry,
  MemorySearchResponse,
  ModuleInfo,
  PendingApproval,
  PendingOwnerQuestion,
  RecallResult,
  RetractRequest,
  RetractResult,
  ScheduleEntry,
  SlashCommand,
  SlashCommandInvocation,
  TasksSearchResponse,
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

/**
 * Append `projectId=<id>` to `path`. Used by every project-scoped daemon
 * route — the daemon's `resolveProjectIdParam` reads this query parameter
 * and rejects unknown ids with a typed `UnknownProjectError` body.
 */
function withProject(path: string, projectId: string): string {
  if (!projectId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}projectId=${encodeURIComponent(projectId)}`;
}

/**
 * Strict-decoded request — fetches `path`, parses the body as JSON, then
 * runs `decode` over the raw value. The decoder mirrors the macOS Swift
 * Codable / mobile parse* boundary contract: unknown discriminator values
 * throw `ContractDecodeError` from `clients/conformance/decoders.ts` so
 * payload drift fails loudly instead of silently flowing into the UI as
 * a typed-but-invalid object. React Query surfaces the throw through the
 * mutation/query `error` channel, which the panels render in the existing
 * destructive-banner style.
 */
async function apiDecoded<T>(
  path: string,
  decode: (raw: unknown) => T,
  options?: RequestInit,
): Promise<T> {
  const raw = await apiJson<unknown>(path, options);
  return decode(raw);
}

export const api = {
  getHealth: () => apiJson<HealthStatus>("/api/health"),

  getDaemonStatus: (projectId: string) =>
    apiJson<{ daemon: DaemonLiveStatus | null }>(
      withProject("/api/daemon/status", projectId),
    ),

  getCapabilities: () => apiJson<CapabilityReadinessResponse>("/capabilities"),

  getIdentity: () => apiJson<ClientIdentity>("/identity"),

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
      {
        method: "POST",
      },
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
    const qs = search.toString();
    return apiJson<{ runs: WorkflowRunSummary[] }>(
      withProject(`/api/workflow/runs${qs ? `?${qs}` : ""}`, projectId),
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

  listSessions: (projectId: string) =>
    apiJson<{ sessions: InteractiveSession[] }>(
      withProject("/api/sessions", projectId),
    ),

  createSession: (projectId: string, autonomyMode?: AutonomyMode) =>
    apiJson<{ session_id: string; autonomy_mode?: AutonomyMode }>(
      withProject("/api/sessions", projectId),
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

  getDigest: (): Promise<DigestResponse> =>
    apiDecoded("/api/digest", parseDigestResponse),

  getAttention: (): Promise<AttentionResponse> =>
    apiDecoded("/api/attention", parseAttentionResponse),

  recall: (query: string): Promise<RecallResult> =>
    apiDecoded("/api/recall", parseRecallResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),

  answer: (query: string): Promise<AnswerResult> =>
    apiDecoded("/api/answer", parseAnswerResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),

  capture: (text: string, filter?: CaptureFilter): Promise<CaptureResult> =>
    apiDecoded("/api/capture", parseCaptureResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filter ? { text, filter } : { text }),
    }),

  retract: (request: RetractRequest): Promise<RetractResult> =>
    apiDecoded("/api/retract", parseRetractResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),

  answerLog: (
    filter?: AnswerHistoryListFilter,
  ): Promise<AnswerHistoryListResult> => {
    const search = new URLSearchParams();
    if (filter?.limit !== undefined) search.set("limit", String(filter.limit));
    if (filter?.beforeId !== undefined) search.set("beforeId", filter.beforeId);
    const qs = search.toString();
    return apiDecoded(
      `/api/answers${qs ? `?${qs}` : ""}`,
      parseAnswerHistoryListResult,
    );
  },

  answerShow: (id: string): Promise<AnswerHistoryShowResult> =>
    apiDecoded(
      `/api/answers/${encodeURIComponent(id)}`,
      parseAnswerHistoryShowResult,
    ),

  knowledge: {
    /**
     * Targets the daemon's `GET /api/knowledge/search?q=&semantic=true&limit=`
     * route and decodes the discriminated success / `semantic_unavailable`
     * envelope through the shared conformance decoder. Mirrors mobile
     * `searchKnowledge` and macOS `DaemonClient.searchKnowledge`.
     */
    search: (query: string, limit = 10): Promise<KnowledgeSearchResponse> => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("semantic", "true");
      params.set("limit", String(limit));
      return apiDecoded(
        `/api/knowledge/search?${params.toString()}`,
        parseKnowledgeSearchResponse,
      );
    },
  },

  memory: {
    /**
     * Targets the daemon's `GET /api/memory/search?q=&semantic=true&limit=`
     * route and decodes the discriminated envelope through the shared
     * conformance decoder.
     */
    search: (query: string, limit = 10): Promise<MemorySearchResponse> => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("semantic", "true");
      params.set("limit", String(limit));
      return apiDecoded(
        `/api/memory/search?${params.toString()}`,
        parseMemorySearchResponse,
      );
    },
  },

  history: {
    /**
     * Targets the daemon's `GET /api/history/search?q=&semantic=true&limit=`
     * route and decodes the discriminated envelope through the shared
     * conformance decoder.
     */
    search: (query: string, limit = 10): Promise<HistorySearchResponse> => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("semantic", "true");
      params.set("limit", String(limit));
      return apiDecoded(
        `/api/history/search?${params.toString()}`,
        parseHistorySearchResponse,
      );
    },
  },

  tasks: {
    /**
     * Targets the daemon's `GET /tasks/search?q=&semantic=true&limit=`
     * control route (note: not under `/api/`) and decodes the discriminated
     * envelope through the shared conformance decoder.
     */
    search: (query: string, limit = 10): Promise<TasksSearchResponse> => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("semantic", "true");
      params.set("limit", String(limit));
      return apiDecoded(
        `/tasks/search?${params.toString()}`,
        parseTasksSearchResponse,
      );
    },
  },

  listSlashCommands: () =>
    apiJson<{ commands: SlashCommand[] }>("/api/commands"),

  invokeSlashCommand: (name: string) =>
    apiJson<SlashCommandInvocation>("/api/commands/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  voiceTranscribe: async (input: {
    audio: Blob;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResult> => {
    const audioBase64 = await blobToBase64(input.audio);
    const res = await apiFetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        mimeType: input.mimeType,
        ...(input.filename !== undefined && { filename: input.filename }),
        ...(input.languageHint !== undefined && {
          languageHint: input.languageHint,
        }),
      }),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: asString(parsed.error) || `HTTP ${res.status}`,
        code: asString(parsed.code),
      };
    }
    return {
      ok: true,
      text: asString(parsed.text),
      language:
        typeof parsed.language === "string" ? parsed.language : undefined,
    };
  },

  voiceSynthesize: async (input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResult> => {
    const res = await apiFetch("/api/voice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: asString(parsed.error) || `HTTP ${res.status}`,
        code: asString(parsed.code),
      };
    }
    return {
      ok: true,
      audio: base64ToBlob(
        asString(parsed.audioBase64),
        asString(parsed.mimeType) || "application/octet-stream",
      ),
      mimeType: asString(parsed.mimeType),
      format: asString(parsed.format),
    };
  },
};

export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code: string };

export type VoiceSynthesizeResult =
  | { ok: true; audio: Blob; mimeType: string; format: string }
  | { ok: false; status: number; error: string; code: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export { apiFetch, getAuthToken };
