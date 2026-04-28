// Daemon API response types

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeMs: number;
  components: Record<string, string>;
}

export interface ActiveRun {
  runId: string;
  workflow: string;
  startedAt: string;
}

export interface WorkflowState {
  activeRuns: ActiveRun[];
  queueLength: number;
  completedRuns: number;
  paused: boolean;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number;
  startedAt: string;
  completedRuns: number;
  lastCompletedWorkflow?: string;
  lastCompletedAt?: string;
  lastCompletedStatus?: string;
  workflow: WorkflowState;
}

export type RunStatus = 'success' | 'failed' | 'interrupted' | 'completed-with-warnings';

export interface RunSummary {
  id: string;
  workflow: string;
  status: RunStatus;
  triggerEvent: string;
  startedAt: string;
  durationMs: number;
  totalCostUsd?: number;
  causedBy?: { runId: string; workflow: string };
  tags?: string[];
}

export interface ToolCall {
  tool: string;
  count: number;
  totalMs: number;
}

export interface RunStep {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  costUsd?: number;
  toolCalls?: ToolCall[];
  reused?: boolean;
}

export interface RunDetail extends RunSummary {
  completedAt?: string;
  steps: RunStep[];
  workflowSteps?: Array<{ id: string; type: string; reason?: string }>;
  warnings?: Array<{ type: string; message: string }>;
}

export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  risk: string;
  reason?: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  timeoutMs?: number;
}

export type OwnerQuestionStatus = 'pending' | 'answered' | 'dismissed' | 'expired';

export interface OwnerQuestion {
  id: string;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  answer?: string;
  answeredAt?: string;
}

export interface TaskCounts {
  inbox?: number;
  ready?: number;
  backlog?: number;
  doing?: number;
  blocked?: number;
}

export interface TaskEntry {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
}

export interface TasksResponse {
  counts: TaskCounts;
  tasks: {
    doing?: TaskEntry[];
    ready?: TaskEntry[];
    backlog?: TaskEntry[];
    blocked?: TaskEntry[];
  };
}

export type SseEventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.step.completed'
  | 'queue.changed'
  | 'approval.changed'
  | 'task.changed'
  | 'owner.question.asked'
  | 'owner.question.changed'
  | 'owner.question.resolved'
  | 'owner.question.dismissed'
  | 'owner.question.expired';

export interface SseEvent {
  type: SseEventType;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export type AutonomyMode = 'passive' | 'supervised' | 'autonomous';

export interface InteractiveSession {
  id: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: 'daemon' | 'serve';
  busy?: boolean;
}

export interface SetAutonomyModeResponse {
  session_id: string;
  autonomy_mode: AutonomyMode;
  source?: string;
  serveOwned?: boolean;
}

export type ChatStreamEventType = 'session' | 'text' | 'thinking' | 'thinking_start' | 'progress' | 'status' | 'cost' | 'error' | 'notification' | 'guardrail' | 'tool_metric' | 'state_change' | 'done';

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  payload: Record<string, unknown>;
}

/**
 * Voice success/failure shapes. Failure carries the daemon's typed `code`
 * (`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`, …) so
 * the mobile UI can render the same vocabulary the CLI and web client use.
 */
export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code: string };

export type VoiceSynthesizeResult =
  | { ok: true; audio: Uint8Array; mimeType: string; format: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      supported?: string[];
    };

/**
 * Mirror of the daemon's `DailyDigestData` shape exported from
 * `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Mobile decodes
 * `GET /api/digest` through these typed structures so the rendered body stays
 * identical to the Telegram, CLI, daemon HTTP, web, and macOS surfaces.
 */
export interface DigestBuilderCommitItem {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  commitSubject: string;
  durationMs: number | null;
}

export interface DigestExplorerAdditionItem {
  runId: string;
  taskCount: number;
  watchlistAdds: number;
}

export interface DigestDecomposerSplitItem {
  runId: string;
  parentTaskId: string | null;
  childTaskCount: number;
}

export interface DigestBlockedPromoterMoveItem {
  runId: string;
  promotedTaskIds: string[];
  toReady: string[];
  toBacklog: string[];
}

export interface DigestFailedRunItem {
  runId: string;
  workflow: string;
  status: 'failed' | 'interrupted';
  startedAt: string;
}

export interface DigestPendingOwnerQuestionItem {
  id: string;
  question: string;
  source: string;
  ageDays: number;
}

export interface DigestAgingOperatorCaptureItem {
  taskId: string;
  ageDays: number;
  path: string;
}

export interface DigestQueueCounts {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
}

export interface DigestQueueDelta {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { [K in keyof DigestQueueCounts]: number | null };
}

export interface DailyDigestData {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: DigestBuilderCommitItem[];
  explorerAdditions: DigestExplorerAdditionItem[];
  decomposerSplits: DigestDecomposerSplitItem[];
  blockedPromoterMoves: DigestBlockedPromoterMoveItem[];
  failedMonitoredRuns: DigestFailedRunItem[];
  pendingOwnerQuestions: DigestPendingOwnerQuestionItem[];
  agingOperatorCaptures: DigestAgingOperatorCaptureItem[];
  queueDelta: DigestQueueDelta;
  quiet: boolean;
}

export interface DigestResponse {
  data: DailyDigestData;
  text: string;
}

/**
 * Mirror of the daemon's on-demand attention envelope exported from
 * `src/modules/autonomy/workflows/attention-digest/step.ts`. The same shape
 * backs the Telegram `/attention`, `kota attention` CLI, daemon HTTP
 * `GET /api/attention`, embedded web `AttentionPanel`, and macOS
 * `AttentionView` surfaces; the mobile AttentionScreen is the seventh.
 */
export interface AttentionItem {
  label: string;
  detail: string;
}

export interface AttentionResponse {
  data: { items: AttentionItem[] };
  text: string;
}

/**
 * Mirror of a single entry returned by the daemon's
 * `GET /api/knowledge/search` route. Decoding is restricted to the four
 * fields the shared `renderKnowledgeSearchPlain` helper consumes
 * (`src/modules/knowledge/render.ts`) so the mobile surface speaks the
 * same line shape as Telegram, the CLI, the embedded web panel, and the
 * macOS menu bar.
 */
export interface KnowledgeEntry {
  id: string;
  type: string;
  status: string;
  title: string;
}

/**
 * Discriminated mirror of the daemon's `GET /api/knowledge/search`
 * response: `{ ok: true, entries: KnowledgeEntry[] }` on success and
 * `{ ok: false, reason: "semantic_unavailable" }` when no
 * embedding-backed knowledge provider is configured. Strict so payload
 * drift fails loudly instead of silently degrading the rendered surface.
 */
export type KnowledgeSearchResponse =
  | { ok: true; entries: KnowledgeEntry[] }
  | { ok: false; reason: 'semantic_unavailable' };

/**
 * Mirror of a single entry returned by the daemon's
 * `GET /api/memory/search` route. Decoding is restricted to the three
 * fields the shared `renderMemorySearchPlain` helper consumes
 * (`src/modules/memory/render.ts`) so the mobile surface speaks the
 * same line shape as Telegram, the CLI, the daemon HTTP route, and the
 * macOS menu bar.
 */
export interface MemoryEntry {
  id: string;
  created: string;
  content: string;
}

/**
 * Discriminated mirror of the daemon's `GET /api/memory/search`
 * response: `{ ok: true, entries: MemoryEntry[] }` on success and
 * `{ ok: false, reason: "semantic_unavailable" }` when no
 * embedding-backed memory provider is configured. Strict so payload
 * drift fails loudly instead of silently degrading the rendered surface.
 */
export type MemorySearchResponse =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; reason: 'semantic_unavailable' };

/**
 * Mirror of a single conversation summary returned by the daemon's
 * `GET /api/history/search` route. Decoding is restricted to the eight
 * fields the shared `renderHistorySearchPlain` helper consumes
 * (`src/modules/history/render.ts` and the `ConversationRecord` shape in
 * `src/core/modules/provider-types.ts`) so the mobile surface speaks the
 * same line shape as Telegram, the CLI, the daemon HTTP route, and the
 * macOS menu bar. `source` is the only optional field, matching the
 * upstream type one-to-one.
 */
export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  cwd: string;
  source?: 'user' | 'action';
}

/**
 * Discriminated mirror of the daemon's `GET /api/history/search`
 * response: `{ ok: true, conversations: ConversationRecord[] }` on
 * success and `{ ok: false, reason: "semantic_unavailable" }` when the
 * configured history provider does not support semantic search. Strict
 * so payload drift fails loudly instead of silently degrading the
 * rendered surface.
 */
export type HistorySearchResponse =
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: false; reason: 'semantic_unavailable' };

/**
 * Mirror of a single search hit returned by the daemon's
 * `GET /tasks/search` route. Decoding is restricted to the eight fields
 * the shared `renderRepoTaskSearchPlain` helper consumes
 * (`src/modules/repo-tasks/render.ts` and the `RepoTaskSearchHit` shape
 * in `src/core/modules/provider-types.ts`) so the mobile surface speaks
 * the same line shape as Telegram, the CLI, the daemon HTTP route, and
 * the macOS menu bar.
 */
export interface RepoTaskSearchHit {
  id: string;
  title: string;
  state: string;
  priority: string;
  area: string;
  summary: string;
  updatedAt: string;
  score: number;
}

/**
 * Discriminated mirror of the daemon's `GET /tasks/search` response:
 * `{ ok: true, tasks: RepoTaskSearchHit[] }` on success and
 * `{ ok: false, reason: "semantic_unavailable" }` when the configured
 * `repo-tasks` provider does not support semantic search. Strict so
 * payload drift fails loudly instead of silently degrading the rendered
 * surface.
 */
export type TasksSearchResponse =
  | { ok: true; tasks: RepoTaskSearchHit[] }
  | { ok: false; reason: 'semantic_unavailable' };

/**
 * Source of a `RecallHit`. Mirrors the daemon's `RecallSource` union exported
 * from `src/core/server/kota-client.ts`. The cross-store recall seam
 * discriminates each hit by which store originated it; adding a new source
 * extends this union and the `RecallHit` discriminated type below.
 */
export type RecallSource = 'knowledge' | 'memory' | 'history' | 'tasks';

export interface RecallKnowledgeHit {
  source: 'knowledge';
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
}

export interface RecallMemoryHit {
  source: 'memory';
  score: number;
  id: string;
  preview: string;
  created: string;
}

export interface RecallHistoryHit {
  source: 'history';
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
}

export interface RecallTasksHit {
  source: 'tasks';
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
}

/**
 * Mirror of one ranked, source-tagged hit returned by the daemon's
 * cross-store recall seam (`POST /recall` and `POST /api/recall` in
 * `src/modules/recall/routes.ts`). Discriminated by `source`; the per-source
 * payload carries the operator-facing metadata each surface renders. Keeps
 * the mobile decode path one-to-one with the macOS `DaemonClient.recall`
 * decoder so the four arms stay identical across both clients.
 */
export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit;

/**
 * Discriminated mirror of the daemon's recall response:
 * `{ ok: true, hits: RecallHit[] }` on success and
 * `{ ok: false, reason: "semantic_unavailable" }` when no contributors are
 * registered. Strict so payload drift fails loudly instead of silently
 * degrading the rendered surface to per-store keyword search.
 */
export type RecallSearchResponse =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: 'semantic_unavailable' };

/**
 * Optional filter accepted by `DaemonClient.recall`. All fields are optional
 * with explicit defaults applied at the daemon seam (`topK` defaults to 20,
 * `minScore` defaults to 0, `sources` defaults to every registered
 * contributor). Mirror of the daemon's `RecallFilter`.
 */
export interface RecallFilter {
  topK?: number;
  minScore?: number;
  sources?: ReadonlyArray<RecallSource>;
}

/**
 * Optional filter accepted by `DaemonClient.answer`. Forwarded to the
 * underlying recall fan-out so callers can shrink the source pile the
 * synthesizer sees. Mirror of the daemon's `AnswerFilter` (alias for
 * `RecallFilter`).
 */
export type AnswerFilter = RecallFilter;

/**
 * Mirror of the daemon's `AnswerCitation` exported from
 * `src/core/server/kota-client.ts`. Each citation is keyed by the same
 * `{ source, id }` discriminator as the underlying `RecallHit`, so a
 * citation always resolves back to the typed hit it cites — no free-form
 * prose pointers, no hallucinated sources.
 */
export interface AnswerCitation {
  source: RecallSource;
  id: string;
}

/**
 * Discriminated mirror of the daemon's cited-answer response shared
 * between the daemon control route (`POST /answer`) and the user-facing
 * route (`POST /api/answer`). Matches the macOS `DaemonClient.answer`
 * decode shape one-to-one:
 *
 * - `{ ok: true, answer, citations, hits }` — one composed answer body
 *   plus typed citations resolving against the typed `RecallHit[]` the
 *   seam consumed.
 * - `{ ok: false, reason: "no_hits" }` — recall returned zero hits;
 *   nothing to synthesize.
 * - `{ ok: false, reason: "semantic_unavailable" }` — recall itself is
 *   unconfigured.
 * - `{ ok: false, reason: "synthesis_failed" }` — the model call failed
 *   or produced malformed citations after the single retry.
 *
 * Strict so payload drift fails loudly instead of silently degrading
 * the rendered surface.
 */
export type AnswerResult =
  | {
      ok: true;
      answer: string;
      citations: AnswerCitation[];
      hits: RecallHit[];
    }
  | {
      ok: false;
      reason: 'no_hits' | 'semantic_unavailable' | 'synthesis_failed';
    };

/**
 * Mirror of the daemon's `AnswerHistoryRecord`
 * (`src/core/server/kota-client.ts`). One persisted envelope per
 * `AnswerProvider.answer(query, filter?)` call regardless of `ok`. The
 * record carries the original query verbatim, the post-default filter
 * actually used, the typed `RecallHit[]` the synthesizer was shown, and
 * the discriminated `AnswerResult` envelope the caller saw — the same
 * shape the CLI / web / Telegram / Slack surfaces consume through the
 * `GET /api/answers/:id` route.
 */
export interface AnswerHistoryRecord {
  id: string;
  createdAt: string;
  query: string;
  filter: AnswerFilter;
  recallHits: RecallHit[];
  result: AnswerResult;
}

/**
 * Compact projection of `AnswerHistoryRecord` for list rendering. The
 * `result` field is closed over the discriminated shape so callers
 * cannot accidentally read fields that only exist on the `ok: true`
 * branch. Mirrors the daemon's `AnswerHistoryEntry`.
 */
export interface AnswerHistoryEntry {
  id: string;
  createdAt: string;
  query: string;
  result:
    | { ok: true; citationCount: number }
    | {
        ok: false;
        reason: 'no_hits' | 'semantic_unavailable' | 'synthesis_failed';
      };
}

/**
 * Filter accepted by `DaemonClient.answerLog`. Both fields are optional;
 * the daemon store applies its own defaults (newest-first, capped page
 * size). Passing `beforeId` returns the next older page after that id.
 */
export interface AnswerHistoryListFilter {
  limit?: number;
  beforeId?: string;
}

/** Mirror of the daemon's `AnswerHistoryListResult`. */
export interface AnswerHistoryListResult {
  entries: AnswerHistoryEntry[];
}

/**
 * Discriminated mirror of the daemon's `AnswerHistoryShowResult`:
 * `{ ok: true, record }` when the id resolved and
 * `{ ok: false, reason: "not_found" }` when no envelope carries that id.
 * Strict so payload drift fails loudly instead of silently degrading the
 * rendered surface to a misleading "loading…" state.
 */
export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: 'not_found' };

/**
 * Target store for `DaemonClient.capture`. Mirrors the daemon's
 * `CaptureTarget` union exported from `src/core/server/kota-client.ts:758`.
 * Adding a fifth contributor extends this union and the `CaptureRecord`
 * arms below.
 */
export type CaptureTarget = 'memory' | 'knowledge' | 'tasks' | 'inbox';

export interface CaptureMemoryRecord {
  target: 'memory';
  recordId: string;
}

export interface CaptureKnowledgeRecord {
  target: 'knowledge';
  recordId: string;
}

export interface CaptureTasksRecord {
  target: 'tasks';
  recordId: string;
  path: string;
}

export interface CaptureInboxRecord {
  target: 'inbox';
  recordId: string;
  path: string;
}

/**
 * Discriminated mirror of the daemon's `CaptureRecord` union
 * (`src/core/server/kota-client.ts:760-797`). Each successful capture
 * returns the typed identifier the underlying store minted; the
 * filesystem-backed contributors (tasks, inbox) additionally carry the
 * path their writer minted so a caller can resolve back to the
 * underlying store. Decoding is keyed by the wire `target` field, with
 * every per-arm field required on the daemon side — no nullable shape.
 */
export type CaptureRecord =
  | CaptureMemoryRecord
  | CaptureKnowledgeRecord
  | CaptureTasksRecord
  | CaptureInboxRecord;

/**
 * Optional filter accepted by `DaemonClient.capture`. Both fields are
 * optional; the daemon seam classifies on its own when `target` is not
 * set. Mirror of the daemon's `CaptureFilter`. A nil target/hint omits
 * the corresponding key on the wire so the seam applies its own typed
 * defaults; when both are nil, the request omits `filter` entirely.
 */
export interface CaptureFilter {
  target?: CaptureTarget;
  hint?: string;
}

/**
 * Discriminated mirror of the daemon's `CaptureResult` envelope
 * (`src/core/server/kota-client.ts:833-846`): one `ok: true` arm
 * carrying the typed `CaptureRecord` plus three `ok: false` arms tagged
 * by `reason`. Strict so payload drift fails loudly instead of silently
 * degrading the rendered surface.
 *
 * - `ambiguous` — the classifier could not pick a single target; the
 *   `suggestions` list is the contributors it considered. The caller
 *   re-issues with an explicit `target` to disambiguate.
 * - `no_contributors` — the seam has no registered contributors at all.
 * - `contributor_failed` — the chosen contributor threw; `target` is
 *   the contributor that ran and `message` is the verbatim error.
 */
export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | {
      ok: false;
      reason: 'ambiguous';
      suggestions: ReadonlyArray<CaptureTarget>;
    }
  | { ok: false; reason: 'no_contributors' }
  | {
      ok: false;
      reason: 'contributor_failed';
      target: CaptureTarget;
      message: string;
    };

/**
 * Stable contributor ordering used by the seam to render `suggestions`
 * deterministically. The mobile picker mirrors this order so the
 * target chip ordering matches what the seam returns and what the web
 * `CapturePanel` renders.
 */
export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  'memory',
  'knowledge',
  'tasks',
  'inbox',
] as const;

/**
 * Target store for `DaemonClient.retract`. Mirrors the daemon's
 * `RetractTarget` union exported from `src/core/server/kota-client.ts`.
 * Adding a fifth contributor extends this union and the per-target arms
 * of `RetractRequest` and `RetractRecord`.
 */
export type RetractTarget = 'memory' | 'knowledge' | 'tasks' | 'inbox';

export interface RetractMemoryRecord {
  target: 'memory';
  recordId: string;
}

export interface RetractKnowledgeRecord {
  target: 'knowledge';
  recordId: string;
}

/**
 * Tasks-store record dropped by a successful retract. The seam routes
 * the task through the existing task-state machine into
 * `data/tasks/dropped/`, so the arm carries the previous and resulting
 * paths plus the explicit destination state.
 */
export interface RetractTasksRecord {
  target: 'tasks';
  recordId: string;
  previousPath: string;
  path: string;
  toState: 'dropped';
}

export interface RetractInboxRecord {
  target: 'inbox';
  recordId: string;
  path: string;
}

/**
 * Discriminated mirror of the daemon's `RetractRecord` union
 * (`src/core/server/kota-client.ts`). Each successful retract returns
 * the typed identifier the underlying store removed; the
 * filesystem-backed contributors carry the path metadata so the
 * operator surface can render "moved to dropped" / "file deleted"
 * without leaking internal moves into the seam.
 */
export type RetractRecord =
  | RetractMemoryRecord
  | RetractKnowledgeRecord
  | RetractTasksRecord
  | RetractInboxRecord;

/**
 * Discriminated mirror of the daemon's `RetractRequest` union
 * (`src/core/server/kota-client.ts`). Each arm carries exactly the
 * typed identifier its target needs — `id` for memory and tasks,
 * `slug` for knowledge, `path` for inbox — so the type system rejects
 * passing a memory `id` to the inbox contributor at compile time.
 */
export type RetractRequest =
  | { target: 'memory'; id: string }
  | { target: 'knowledge'; slug: string }
  | { target: 'tasks'; id: string }
  | { target: 'inbox'; path: string };

/**
 * Discriminated mirror of the daemon's `RetractResult` envelope
 * (`src/core/server/kota-client.ts`): one `ok: true` arm carrying the
 * typed `RetractRecord`, plus three `ok: false` failure arms tagged by
 * `reason`. Strict so payload drift fails loudly instead of silently
 * degrading the rendered surface.
 *
 * - `no_contributors` — the seam itself is unconfigured (zero
 *   contributors registered, or the named target is not registered).
 * - `not_found` — the named record is not present in the named target;
 *   the seam never falls back into a different store.
 * - `contributor_failed` — the chosen contributor threw; `target` is
 *   the contributor that ran and `message` is the verbatim error.
 */
export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: 'no_contributors' }
  | {
      ok: false;
      reason: 'not_found';
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: 'contributor_failed';
      target: RetractTarget;
      message: string;
    };

/**
 * Stable retract-target ordering. Mirrors the seam's
 * `RETRACT_TARGET_ORDER` so the mobile picker option order matches the
 * agent, CLI, web, and macOS surfaces.
 */
export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  'memory',
  'knowledge',
  'tasks',
  'inbox',
] as const;
