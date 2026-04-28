import type {
  AnswerCitation,
  AnswerFilter,
  AnswerHistoryEntry,
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
  Approval,
  AttentionResponse,
  AutonomyMode,
  CaptureFilter,
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
  ConversationRecord,
  RetractRecord,
  RetractRequest,
  RetractResult,
  RetractTarget,
  DaemonStatus,
  DigestResponse,
  HealthResponse,
  HistorySearchResponse,
  InteractiveSession,
  KnowledgeEntry,
  KnowledgeSearchResponse,
  MemoryEntry,
  MemorySearchResponse,
  OwnerQuestion,
  RecallFilter,
  RecallHit,
  RecallSearchResponse,
  RecallSource,
  RepoTaskSearchHit,
  RunDetail,
  RunSummary,
  SetAutonomyModeResponse,
  TasksResponse,
  TasksSearchResponse,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from './types';
import { CAPTURE_TARGET_ORDER, RETRACT_TARGET_ORDER } from './types';
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

  /**
   * Targets the daemon's `GET /api/history/search?q=&semantic=true&limit=`
   * route and decodes the discriminated `{ ok: true, conversations }` /
   * `{ ok: false, reason: "semantic_unavailable" }` response. Mirrors the
   * macOS `DaemonClient.searchHistory` decode discipline: the response
   * shape is validated explicitly so payload drift throws instead of
   * silently degrading to keyword search behind the operator's back.
   */
  async searchHistory(
    query: string,
    limit = 10,
  ): Promise<HistorySearchResponse> {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('semantic', 'true');
    params.set('limit', String(limit));
    const parsed = await this.request<unknown>(
      `/api/history/search?${params.toString()}`,
    );
    return parseHistorySearchResponse(parsed);
  }

  /**
   * Targets the daemon's `GET /tasks/search?q=&semantic=true&limit=`
   * control route and decodes the discriminated
   * `{ ok: true, tasks }` / `{ ok: false, reason: "semantic_unavailable" }`
   * response. Mirrors the macOS `DaemonClient.searchTasks` decode
   * discipline: the response shape is validated explicitly so payload
   * drift throws instead of silently degrading to keyword search behind
   * the operator's back. Note the route lives at `/tasks/search` (not
   * under `/api/`), matching the daemon control registration.
   */
  async searchTasks(query: string, limit = 10): Promise<TasksSearchResponse> {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('semantic', 'true');
    params.set('limit', String(limit));
    const parsed = await this.request<unknown>(
      `/tasks/search?${params.toString()}`,
    );
    return parseTasksSearchResponse(parsed);
  }

  /**
   * Targets the daemon's `POST /api/recall` user-facing route — the same
   * route the embedded web `RecallPanel` consumes — and decodes the
   * discriminated `{ ok: true, hits }` /
   * `{ ok: false, reason: "semantic_unavailable" }` envelope. Mirrors the
   * macOS `DaemonClient.recall` decode discipline: response shapes are
   * validated explicitly so payload drift throws instead of silently
   * degrading the rendered surface to per-store keyword search behind the
   * operator's back. The optional `filter` field is only sent when at least
   * one of `topK` / `minScore` / `sources` is set, so the daemon seam
   * applies its typed defaults (`RECALL_DEFAULT_TOP_K = 20`, no min-score
   * floor, every registered contributor).
   */
  async recall(
    query: string,
    options: RecallFilter = {},
  ): Promise<RecallSearchResponse> {
    const filter: RecallFilter = {};
    if (options.topK !== undefined) filter.topK = options.topK;
    if (options.minScore !== undefined) filter.minScore = options.minScore;
    if (options.sources !== undefined) filter.sources = options.sources;
    const body: Record<string, unknown> = { query };
    if (Object.keys(filter).length > 0) body.filter = filter;
    const parsed = await this.request<unknown>('/api/recall', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return parseRecallSearchResponse(parsed);
  }

  /**
   * Targets the daemon's `POST /api/answer` user-facing route — the same
   * route the embedded web `AnswerPanel` and Telegram `/answer` consume
   * — and decodes the discriminated four-arm `AnswerResult`: one
   * synthesized-success arm carrying `answer`, `citations`, and the
   * typed `RecallHit[]` they resolve against, plus three `ok: false`
   * failure arms (`no_hits`, `semantic_unavailable`, `synthesis_failed`).
   * Mirrors the macOS `DaemonClient.answer` decode discipline: response
   * shapes are validated explicitly so payload drift throws instead of
   * silently degrading the rendered surface. The optional `filter`
   * field is only sent when at least one of `topK` / `minScore` /
   * `sources` is set, so the daemon seam applies its typed defaults.
   */
  async answer(
    query: string,
    options: AnswerFilter = {},
  ): Promise<AnswerResult> {
    const filter: AnswerFilter = {};
    if (options.topK !== undefined) filter.topK = options.topK;
    if (options.minScore !== undefined) filter.minScore = options.minScore;
    if (options.sources !== undefined) filter.sources = options.sources;
    const body: Record<string, unknown> = { query };
    if (Object.keys(filter).length > 0) body.filter = filter;
    const parsed = await this.request<unknown>('/api/answer', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return parseAnswerResult(parsed);
  }

  /**
   * Targets the daemon's `GET /api/answers` route — the same route the
   * web `AnswerHistoryPanel`, the Slack `/answer-log` reply, the
   * Telegram `/answer-log` reply, and the `kota answer log` CLI all
   * consume — and decodes the typed `AnswerHistoryListResult`. Mirrors
   * the existing mobile `recall` / `answer` decode discipline: response
   * shapes are validated explicitly so payload drift throws instead of
   * silently degrading the rendered surface. The optional `beforeId`
   * cursor and `limit` are emitted as query params only when set so the
   * daemon store applies its own typed defaults (newest-first, capped
   * page size).
   */
  async answerLog(
    filter: AnswerHistoryListFilter = {},
  ): Promise<AnswerHistoryListResult> {
    const params = new URLSearchParams();
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.beforeId !== undefined) params.set('beforeId', filter.beforeId);
    const qs = params.toString();
    const path = `/api/answers${qs ? `?${qs}` : ''}`;
    const parsed = await this.request<unknown>(path);
    return parseAnswerHistoryListResult(parsed);
  }

  /**
   * Targets the daemon's `GET /api/answers/:id` route and decodes the
   * discriminated `AnswerHistoryShowResult`: `{ ok: true, record }` for
   * a hit, `{ ok: false, reason: "not_found" }` for an id the store has
   * no envelope for. Mirrors the existing mobile decode discipline:
   * response shapes are validated explicitly so payload drift throws
   * instead of silently degrading the rendered surface to a misleading
   * "loading…" state.
   */
  async answerShow(id: string): Promise<AnswerHistoryShowResult> {
    const path = `/api/answers/${encodeURIComponent(id)}`;
    const parsed = await this.request<unknown>(path);
    return parseAnswerHistoryShowResult(parsed);
  }

  /**
   * Targets the daemon's `POST /api/capture` user-facing route — the
   * same route the embedded web `CapturePanel` consumes — and decodes
   * the discriminated four-arm `CaptureResult`: one `ok: true` arm
   * carrying the typed `CaptureRecord`, plus three `ok: false` arms
   * (`ambiguous`, `no_contributors`, `contributor_failed`). The optional
   * per-field filter keys (`target`, `hint`) are emitted only when set
   * so the seam applies its own typed defaults (classifier picks the
   * target; no hint passed). When both are nil, the `filter` key is
   * omitted entirely. Mirrors the macOS `DaemonClient.capture` decode
   * discipline: payload drift fails loudly instead of silently
   * degrading the rendered surface.
   */
  async capture(
    text: string,
    options: CaptureFilter = {},
  ): Promise<CaptureResult> {
    const filter: CaptureFilter = {};
    if (options.target !== undefined) filter.target = options.target;
    if (options.hint !== undefined) filter.hint = options.hint;
    const body: Record<string, unknown> = { text };
    if (Object.keys(filter).length > 0) body.filter = filter;
    const parsed = await this.request<unknown>('/api/capture', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return parseCaptureResult(parsed);
  }

  /**
   * Targets the daemon's `POST /api/retract` user-facing route — the
   * same route the embedded web `RetractPanel` consumes — and decodes
   * the discriminated four-arm `RetractResult`: one `ok: true` arm
   * carrying the typed `RetractRecord`, plus three `ok: false` arms
   * (`no_contributors`, `not_found`, `contributor_failed`). The wire
   * shape mirrors the daemon's `RetractRequest` discriminated union:
   * `{ target, id }` for memory/tasks, `{ target, slug }` for
   * knowledge, `{ target, path }` for inbox. Mirrors the macOS
   * `DaemonClient.retract` decode discipline: payload drift fails
   * loudly instead of silently degrading the rendered surface.
   */
  async retract(request: RetractRequest): Promise<RetractResult> {
    const parsed = await this.request<unknown>('/api/retract', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    return parseRetractResult(parsed);
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

function parseHistorySearchResponse(value: unknown): HistorySearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid history search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.conversations)) {
      throw new Error(
        'Invalid history search response: conversations missing',
      );
    }
    const conversations = obj.conversations.map(parseConversationRecord);
    return { ok: true, conversations };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid history search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid history search response: missing ok flag');
}

function parseTasksSearchResponse(value: unknown): TasksSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid tasks search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.tasks)) {
      throw new Error('Invalid tasks search response: tasks missing');
    }
    const tasks = obj.tasks.map(parseRepoTaskSearchHit);
    return { ok: true, tasks };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid tasks search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid tasks search response: missing ok flag');
}

function parseRepoTaskSearchHit(value: unknown): RepoTaskSearchHit {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid repo task hit');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.title !== 'string' ||
    typeof obj.state !== 'string' ||
    typeof obj.priority !== 'string' ||
    typeof obj.area !== 'string' ||
    typeof obj.summary !== 'string' ||
    typeof obj.updatedAt !== 'string' ||
    typeof obj.score !== 'number'
  ) {
    throw new Error('Invalid repo task hit: missing required fields');
  }
  return {
    id: obj.id,
    title: obj.title,
    state: obj.state,
    priority: obj.priority,
    area: obj.area,
    summary: obj.summary,
    updatedAt: obj.updatedAt,
    score: obj.score,
  };
}

function parseConversationRecord(value: unknown): ConversationRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid conversation record');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.title !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.updatedAt !== 'string' ||
    typeof obj.model !== 'string' ||
    typeof obj.messageCount !== 'number' ||
    typeof obj.cwd !== 'string'
  ) {
    throw new Error('Invalid conversation record: missing required fields');
  }
  const record: ConversationRecord = {
    id: obj.id,
    title: obj.title,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    model: obj.model,
    messageCount: obj.messageCount,
    cwd: obj.cwd,
  };
  if (obj.source === 'user' || obj.source === 'action') {
    record.source = obj.source;
  } else if (obj.source !== undefined) {
    throw new Error(
      `Invalid conversation record: unknown source ${String(obj.source)}`,
    );
  }
  return record;
}

function parseRecallSearchResponse(value: unknown): RecallSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid recall response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.hits)) {
      throw new Error('Invalid recall response: hits missing');
    }
    const hits = obj.hits.map(parseRecallHit);
    return { ok: true, hits };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid recall response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid recall response: missing ok flag');
}

function parseRecallHit(value: unknown): RecallHit {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid recall hit');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.source !== 'string' ||
    typeof obj.score !== 'number' ||
    typeof obj.id !== 'string'
  ) {
    throw new Error('Invalid recall hit: missing required fields');
  }
  switch (obj.source) {
    case 'knowledge':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.preview !== 'string' ||
        typeof obj.updated !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing knowledge fields');
      }
      return {
        source: 'knowledge',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        preview: obj.preview,
        updated: obj.updated,
      };
    case 'memory':
      if (
        typeof obj.preview !== 'string' ||
        typeof obj.created !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing memory fields');
      }
      return {
        source: 'memory',
        score: obj.score,
        id: obj.id,
        preview: obj.preview,
        created: obj.created,
      };
    case 'history':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.cwd !== 'string' ||
        typeof obj.updatedAt !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing history fields');
      }
      return {
        source: 'history',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        cwd: obj.cwd,
        updatedAt: obj.updatedAt,
      };
    case 'tasks':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.state !== 'string' ||
        typeof obj.priority !== 'string' ||
        typeof obj.updatedAt !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing tasks fields');
      }
      return {
        source: 'tasks',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        state: obj.state,
        priority: obj.priority,
        updatedAt: obj.updatedAt,
      };
    default:
      throw new Error(`Invalid recall hit: unknown source ${String(obj.source)}`);
  }
}

const ANSWER_REASONS: ReadonlyArray<'no_hits' | 'semantic_unavailable' | 'synthesis_failed'> = [
  'no_hits',
  'semantic_unavailable',
  'synthesis_failed',
];

function parseAnswerResult(value: unknown): AnswerResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (typeof obj.answer !== 'string') {
      throw new Error('Invalid answer response: answer missing');
    }
    if (!Array.isArray(obj.citations)) {
      throw new Error('Invalid answer response: citations missing');
    }
    if (!Array.isArray(obj.hits)) {
      throw new Error('Invalid answer response: hits missing');
    }
    const citations = obj.citations.map(parseAnswerCitation);
    const hits = obj.hits.map(parseRecallHit);
    return { ok: true, answer: obj.answer, citations, hits };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (
      typeof reason !== 'string' ||
      !(ANSWER_REASONS as readonly string[]).includes(reason)
    ) {
      throw new Error(
        `Invalid answer response: unknown reason ${String(reason)}`,
      );
    }
    return {
      ok: false,
      reason: reason as 'no_hits' | 'semantic_unavailable' | 'synthesis_failed',
    };
  }
  throw new Error('Invalid answer response: missing ok flag');
}

const ANSWER_CITATION_SOURCES: ReadonlyArray<RecallSource> = [
  'knowledge',
  'memory',
  'history',
  'tasks',
];

function parseAnswerCitation(value: unknown): AnswerCitation {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer citation');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.source !== 'string' ||
    !(ANSWER_CITATION_SOURCES as readonly string[]).includes(obj.source) ||
    typeof obj.id !== 'string'
  ) {
    throw new Error('Invalid answer citation: missing required fields');
  }
  return { source: obj.source as RecallSource, id: obj.id };
}

const CAPTURE_TARGETS: ReadonlyArray<CaptureTarget> = CAPTURE_TARGET_ORDER;

function parseCaptureTarget(value: unknown, context: string): CaptureTarget {
  if (
    typeof value !== 'string' ||
    !(CAPTURE_TARGETS as readonly string[]).includes(value)
  ) {
    throw new Error(`Invalid capture ${context}: unknown target ${String(value)}`);
  }
  return value as CaptureTarget;
}

function parseCaptureRecord(value: unknown): CaptureRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid capture record: not an object');
  }
  const obj = value as Record<string, unknown>;
  const target = parseCaptureTarget(obj.target, 'record');
  if (typeof obj.recordId !== 'string') {
    throw new Error('Invalid capture record: recordId missing');
  }
  switch (target) {
    case 'memory':
      return { target: 'memory', recordId: obj.recordId };
    case 'knowledge':
      return { target: 'knowledge', recordId: obj.recordId };
    case 'tasks':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid capture record: tasks path missing');
      }
      return { target: 'tasks', recordId: obj.recordId, path: obj.path };
    case 'inbox':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid capture record: inbox path missing');
      }
      return { target: 'inbox', recordId: obj.recordId, path: obj.path };
  }
}

const ANSWER_HISTORY_REASONS: ReadonlyArray<
  'no_hits' | 'semantic_unavailable' | 'synthesis_failed'
> = ['no_hits', 'semantic_unavailable', 'synthesis_failed'];

function parseAnswerFilter(value: unknown): AnswerFilter {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history record: filter not an object');
  }
  const obj = value as Record<string, unknown>;
  const filter: AnswerFilter = {};
  if (obj.topK !== undefined) {
    if (typeof obj.topK !== 'number') {
      throw new Error('Invalid answer history record: filter.topK not a number');
    }
    filter.topK = obj.topK;
  }
  if (obj.minScore !== undefined) {
    if (typeof obj.minScore !== 'number') {
      throw new Error(
        'Invalid answer history record: filter.minScore not a number',
      );
    }
    filter.minScore = obj.minScore;
  }
  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      throw new Error(
        'Invalid answer history record: filter.sources not an array',
      );
    }
    const sources: RecallSource[] = obj.sources.map((s) => {
      if (
        typeof s !== 'string' ||
        !(ANSWER_CITATION_SOURCES as readonly string[]).includes(s)
      ) {
        throw new Error(
          `Invalid answer history record: unknown source ${String(s)}`,
        );
      }
      return s as RecallSource;
    });
    filter.sources = sources;
  }
  return filter;
}

function parseAnswerHistoryEntry(value: unknown): AnswerHistoryEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history entry: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.query !== 'string'
  ) {
    throw new Error('Invalid answer history entry: missing required fields');
  }
  const result = obj.result;
  if (result === null || typeof result !== 'object') {
    throw new Error('Invalid answer history entry: result not an object');
  }
  const r = result as Record<string, unknown>;
  if (r.ok === true) {
    if (typeof r.citationCount !== 'number') {
      throw new Error('Invalid answer history entry: citationCount not a number');
    }
    return {
      id: obj.id,
      createdAt: obj.createdAt,
      query: obj.query,
      result: { ok: true, citationCount: r.citationCount },
    };
  }
  if (r.ok === false) {
    if (
      typeof r.reason !== 'string' ||
      !(ANSWER_HISTORY_REASONS as readonly string[]).includes(r.reason)
    ) {
      throw new Error(
        `Invalid answer history entry: unknown reason ${String(r.reason)}`,
      );
    }
    return {
      id: obj.id,
      createdAt: obj.createdAt,
      query: obj.query,
      result: {
        ok: false,
        reason: r.reason as
          | 'no_hits'
          | 'semantic_unavailable'
          | 'synthesis_failed',
      },
    };
  }
  throw new Error('Invalid answer history entry: missing ok flag');
}

function parseAnswerHistoryListResult(
  value: unknown,
): AnswerHistoryListResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history list response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    throw new Error(
      'Invalid answer history list response: entries missing',
    );
  }
  const entries = obj.entries.map(parseAnswerHistoryEntry);
  return { entries };
}

function parseAnswerHistoryRecord(value: unknown): AnswerHistoryRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history record: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.query !== 'string'
  ) {
    throw new Error('Invalid answer history record: missing required fields');
  }
  if (!Array.isArray(obj.recallHits)) {
    throw new Error('Invalid answer history record: recallHits missing');
  }
  const filter = parseAnswerFilter(obj.filter);
  const recallHits = obj.recallHits.map(parseRecallHit);
  const result = parseAnswerResult(obj.result);
  return {
    id: obj.id,
    createdAt: obj.createdAt,
    query: obj.query,
    filter,
    recallHits,
    result,
  };
}

function parseAnswerHistoryShowResult(
  value: unknown,
): AnswerHistoryShowResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history show response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseAnswerHistoryRecord(obj.record) };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'not_found') {
      throw new Error(
        `Invalid answer history show response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'not_found' };
  }
  throw new Error('Invalid answer history show response: missing ok flag');
}

function parseCaptureResult(value: unknown): CaptureResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid capture response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseCaptureRecord(obj.record) };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (reason === 'ambiguous') {
      if (!Array.isArray(obj.suggestions)) {
        throw new Error('Invalid capture response: suggestions missing');
      }
      const suggestions = obj.suggestions.map((s) =>
        parseCaptureTarget(s, 'suggestion'),
      );
      return { ok: false, reason: 'ambiguous', suggestions };
    }
    if (reason === 'no_contributors') {
      return { ok: false, reason: 'no_contributors' };
    }
    if (reason === 'contributor_failed') {
      const target = parseCaptureTarget(obj.target, 'failure');
      if (typeof obj.message !== 'string') {
        throw new Error('Invalid capture response: contributor_failed message missing');
      }
      return {
        ok: false,
        reason: 'contributor_failed',
        target,
        message: obj.message,
      };
    }
    throw new Error(
      `Invalid capture response: unknown reason ${String(reason)}`,
    );
  }
  throw new Error('Invalid capture response: missing ok flag');
}

const RETRACT_TARGETS: ReadonlyArray<RetractTarget> = RETRACT_TARGET_ORDER;

function parseRetractTarget(value: unknown, context: string): RetractTarget {
  if (
    typeof value !== 'string' ||
    !(RETRACT_TARGETS as readonly string[]).includes(value)
  ) {
    throw new Error(`Invalid retract ${context}: unknown target ${String(value)}`);
  }
  return value as RetractTarget;
}

function parseRetractRecord(value: unknown): RetractRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid retract record: not an object');
  }
  const obj = value as Record<string, unknown>;
  const target = parseRetractTarget(obj.target, 'record');
  if (typeof obj.recordId !== 'string') {
    throw new Error('Invalid retract record: recordId missing');
  }
  switch (target) {
    case 'memory':
      return { target: 'memory', recordId: obj.recordId };
    case 'knowledge':
      return { target: 'knowledge', recordId: obj.recordId };
    case 'tasks':
      if (typeof obj.previousPath !== 'string') {
        throw new Error('Invalid retract record: tasks previousPath missing');
      }
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid retract record: tasks path missing');
      }
      if (obj.toState !== 'dropped') {
        throw new Error(
          `Invalid retract record: tasks toState must be "dropped" (got ${String(obj.toState)})`,
        );
      }
      return {
        target: 'tasks',
        recordId: obj.recordId,
        previousPath: obj.previousPath,
        path: obj.path,
        toState: 'dropped',
      };
    case 'inbox':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid retract record: inbox path missing');
      }
      return { target: 'inbox', recordId: obj.recordId, path: obj.path };
  }
}

function parseRetractResult(value: unknown): RetractResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid retract response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseRetractRecord(obj.record) };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (reason === 'no_contributors') {
      return { ok: false, reason: 'no_contributors' };
    }
    if (reason === 'not_found') {
      const target = parseRetractTarget(obj.target, 'not_found');
      if (typeof obj.identifier !== 'string') {
        throw new Error('Invalid retract response: not_found identifier missing');
      }
      return {
        ok: false,
        reason: 'not_found',
        target,
        identifier: obj.identifier,
      };
    }
    if (reason === 'contributor_failed') {
      const target = parseRetractTarget(obj.target, 'contributor_failed');
      if (typeof obj.message !== 'string') {
        throw new Error('Invalid retract response: contributor_failed message missing');
      }
      return {
        ok: false,
        reason: 'contributor_failed',
        target,
        message: obj.message,
      };
    }
    throw new Error(
      `Invalid retract response: unknown reason ${String(reason)}`,
    );
  }
  throw new Error('Invalid retract response: missing ok flag');
}
