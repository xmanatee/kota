import type {
  Approval,
  AttentionResponse,
  AutonomyMode,
  DaemonStatus,
  DigestResponse,
  HealthResponse,
  InteractiveSession,
  KnowledgeEntry,
  KnowledgeSearchResponse,
  MemoryEntry,
  MemorySearchResponse,
  OwnerQuestion,
  RunDetail,
  RunSummary,
  SetAutonomyModeResponse,
  TasksResponse,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from './types';
import { bytesToBase64, base64ToBytes } from './voice/base64';

export class DaemonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<HealthResponse> {
    return fetch(`${this.baseUrl}/health`).then((r) => r.json());
  }

  getStatus(): Promise<DaemonStatus> {
    return this.request<DaemonStatus>('/status');
  }

  getRuns(workflow?: string, limit = 20): Promise<{ runs: RunSummary[] }> {
    const params = new URLSearchParams();
    if (workflow) params.set('workflow', workflow);
    params.set('limit', String(limit));
    return this.request<{ runs: RunSummary[] }>(`/workflow/runs?${params}`);
  }

  getRunDetail(id: string): Promise<RunDetail> {
    return this.request<RunDetail>(`/workflow/runs/${encodeURIComponent(id)}`);
  }

  getApprovals(): Promise<{ approvals: Approval[] }> {
    return this.request<{ approvals: Approval[] }>('/approvals');
  }

  approve(id: string, note?: string): Promise<{ approval: Approval }> {
    return this.request<{ approval: Approval }>(
      `/approvals/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: note !== undefined ? JSON.stringify({ note }) : undefined,
      },
    );
  }

  reject(id: string, reason?: string): Promise<{ approval: Approval }> {
    return this.request<{ approval: Approval }>(
      `/approvals/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
      },
    );
  }

  getTasks(): Promise<TasksResponse> {
    return this.request<TasksResponse>('/tasks');
  }

  getOwnerQuestions(): Promise<{ questions: OwnerQuestion[] }> {
    return this.request<{ questions: OwnerQuestion[] }>('/owner-questions');
  }

  answerOwnerQuestion(id: string, answer: string): Promise<{ question: OwnerQuestion }> {
    return this.request<{ question: OwnerQuestion }>(
      `/owner-questions/${encodeURIComponent(id)}/answer`,
      {
        method: 'POST',
        body: JSON.stringify({ answer }),
      },
    );
  }

  dismissOwnerQuestion(id: string, reason?: string): Promise<{ question: OwnerQuestion }> {
    return this.request<{ question: OwnerQuestion }>(
      `/owner-questions/${encodeURIComponent(id)}/dismiss`,
      {
        method: 'POST',
        body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
      },
    );
  }

  getDigest(): Promise<DigestResponse> {
    return this.request<DigestResponse>('/api/digest');
  }

  getAttention(): Promise<AttentionResponse> {
    return this.request<AttentionResponse>('/api/attention');
  }

  /**
   * Targets the daemon's `GET /api/knowledge/search?q=&semantic=true&limit=`
   * route and decodes the discriminated `{ ok: true, entries }` /
   * `{ ok: false, reason: "semantic_unavailable" }` response. Mirrors the
   * macOS `DaemonClient.searchKnowledge` decode discipline: the response
   * shape is validated explicitly so payload drift throws instead of
   * silently degrading to keyword search behind the operator's back.
   */
  async searchKnowledge(
    query: string,
    limit = 10,
  ): Promise<KnowledgeSearchResponse> {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('semantic', 'true');
    params.set('limit', String(limit));
    const parsed = await this.request<unknown>(
      `/api/knowledge/search?${params.toString()}`,
    );
    return parseKnowledgeSearchResponse(parsed);
  }

  /**
   * Targets the daemon's `GET /api/memory/search?q=&semantic=true&limit=`
   * route and decodes the discriminated `{ ok: true, entries }` /
   * `{ ok: false, reason: "semantic_unavailable" }` response. Mirrors the
   * macOS `DaemonClient.searchMemory` decode discipline: the response
   * shape is validated explicitly so payload drift throws instead of
   * silently degrading to keyword search behind the operator's back.
   */
  async searchMemory(
    query: string,
    limit = 10,
  ): Promise<MemorySearchResponse> {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('semantic', 'true');
    params.set('limit', String(limit));
    const parsed = await this.request<unknown>(
      `/api/memory/search?${params.toString()}`,
    );
    return parseMemorySearchResponse(parsed);
  }

  registerPushToken(deviceId: string, token: string): Promise<{ ok: boolean }> {
    return this.request('/push-tokens', {
      method: 'POST',
      body: JSON.stringify({ deviceId, token }),
    });
  }

  pauseDispatch(): Promise<{ ok: boolean; paused: boolean }> {
    return this.request('/workflow/pause', { method: 'POST' });
  }

  resumeDispatch(): Promise<{ ok: boolean; paused: boolean }> {
    return this.request('/workflow/resume', { method: 'POST' });
  }

  getSessions(): Promise<{ sessions: InteractiveSession[] }> {
    return this.request<{ sessions: InteractiveSession[] }>('/sessions');
  }

  createSession(
    autonomyMode?: AutonomyMode,
  ): Promise<{ session_id: string; autonomy_mode?: AutonomyMode }> {
    return this.request<{ session_id: string; autonomy_mode?: AutonomyMode }>(
      '/sessions',
      {
        method: 'POST',
        body: JSON.stringify(
          autonomyMode ? { autonomy_mode: autonomyMode } : {},
        ),
      },
    );
  }

  setSessionAutonomyMode(
    id: string,
    mode: AutonomyMode,
  ): Promise<SetAutonomyModeResponse> {
    return this.request<SetAutonomyModeResponse>(
      `/sessions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ autonomy_mode: mode }),
      },
    );
  }

  async deleteSession(id: string): Promise<void> {
    const url = `${this.baseUrl}/sessions/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }

  async voiceTranscribe(input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResult> {
    const body: Record<string, string> = {
      audioBase64: bytesToBase64(input.audio),
      mimeType: input.mimeType,
    };
    if (input.filename !== undefined) body.filename = input.filename;
    if (input.languageHint !== undefined) body.languageHint = input.languageHint;

    const res = await fetch(`${this.baseUrl}/voice/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: stringFrom(parsed.error) || `HTTP ${res.status}`,
        code: stringFrom(parsed.code),
      };
    }
    const language = typeof parsed.language === 'string' ? parsed.language : undefined;
    return language !== undefined
      ? { ok: true, text: stringFrom(parsed.text), language }
      : { ok: true, text: stringFrom(parsed.text) };
  }

  async voiceSynthesize(input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResult> {
    const res = await fetch(`${this.baseUrl}/voice/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(input),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const supported = Array.isArray(parsed.supported)
        ? parsed.supported.filter((v): v is string => typeof v === 'string')
        : undefined;
      const failure: VoiceSynthesizeResult = {
        ok: false,
        status: res.status,
        error: stringFrom(parsed.error) || `HTTP ${res.status}`,
        code: stringFrom(parsed.code),
      };
      return supported !== undefined ? { ...failure, supported } : failure;
    }
    return {
      ok: true,
      audio: base64ToBytes(stringFrom(parsed.audioBase64)),
      mimeType: stringFrom(parsed.mimeType),
      format: stringFrom(parsed.format),
    };
  }

  /** Returns the chat streaming URL for POST /sessions/:id/chat. */
  chatUrl(sessionId: string): string {
    return `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/chat`;
  }

  /** Returns the SSE endpoint URL (used by useSSE hook). */
  sseUrl(since?: string): string {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return `${this.baseUrl}/events${params}`;
  }

  get authHeader(): string {
    return `Bearer ${this.token}`;
  }
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseKnowledgeSearchResponse(value: unknown): KnowledgeSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid knowledge search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.entries)) {
      throw new Error('Invalid knowledge search response: entries missing');
    }
    const entries = obj.entries.map(parseKnowledgeEntry);
    return { ok: true, entries };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid knowledge search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid knowledge search response: missing ok flag');
}

function parseKnowledgeEntry(value: unknown): KnowledgeEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid knowledge entry');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.type !== 'string' ||
    typeof obj.status !== 'string' ||
    typeof obj.title !== 'string'
  ) {
    throw new Error('Invalid knowledge entry: missing required fields');
  }
  return { id: obj.id, type: obj.type, status: obj.status, title: obj.title };
}

function parseMemorySearchResponse(value: unknown): MemorySearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid memory search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.entries)) {
      throw new Error('Invalid memory search response: entries missing');
    }
    const entries = obj.entries.map(parseMemoryEntry);
    return { ok: true, entries };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid memory search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid memory search response: missing ok flag');
}

function parseMemoryEntry(value: unknown): MemoryEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid memory entry');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.created !== 'string' ||
    typeof obj.content !== 'string'
  ) {
    throw new Error('Invalid memory entry: missing required fields');
  }
  return { id: obj.id, created: obj.created, content: obj.content };
}
