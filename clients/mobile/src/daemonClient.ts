// Mobile DaemonClient facade. Each method delegates to a per-namespace
// handler under `./daemon/<namespace>`. Wire shaping, parsers, and
// strict response decoding live in those namespace files; this class
// just owns the `(baseUrl, token)` pair and the public API surface.
// See `clients/mobile/AGENTS.md` for the split shape.

import type {
  AnswerFilter,
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowResult,
  AnswerResult,
  Approval,
  AttentionResponse,
  AutonomyMode,
  CaptureFilter,
  CaptureResult,
  DaemonStatus,
  DigestResponse,
  HealthResponse,
  HistorySearchResponse,
  InteractiveSession,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  OwnerQuestion,
  RecallFilter,
  RecallSearchResponse,
  RetractRequest,
  RetractResult,
  RunDetail,
  RunSummary,
  SetAutonomyModeResponse,
  TasksResponse,
  TasksSearchResponse,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from './daemon';
import * as approvals from './daemon/approvals';
import * as core from './daemon/core';
import * as digest from './daemon/digest';
import * as attention from './daemon/attention';
import * as ownerQuestions from './daemon/ownerQuestions';
import * as tasks from './daemon/tasks';
import * as knowledge from './daemon/knowledge';
import * as memory from './daemon/memory';
import * as history from './daemon/history';
import * as repoTasks from './daemon/repoTasks';
import * as recallNs from './daemon/recall';
import * as answerNs from './daemon/answer';
import * as captureNs from './daemon/capture';
import * as retractNs from './daemon/retract';
import * as sessions from './daemon/sessions';
import * as push from './daemon/push';
import * as voice from './daemon/voice';
import type { DaemonHttp } from './daemon/http';

export class DaemonClient {
  private readonly http: DaemonHttp;

  constructor(baseUrl: string, token: string) {
    this.http = { baseUrl, token };
  }

  health(): Promise<HealthResponse> {
    return core.getHealth(this.http);
  }

  getIdentity(): Promise<core.ClientIdentity> {
    return core.getIdentity(this.http);
  }

  getProjects(): Promise<import('./daemon/conformance/decoders').ProjectRegistryProjection> {
    return core.getProjects(this.http);
  }

  getScopes(): Promise<import('./daemon/conformance/decoders').ScopeRegistryProjection> {
    return core.getScopes(this.http);
  }

  getStatus(projectId?: string): Promise<DaemonStatus> {
    return core.getStatus(this.http, projectId);
  }

  getRuns(
    workflow?: string,
    limit = 20,
    projectId?: string,
  ): Promise<{ runs: RunSummary[] }> {
    return core.getRuns(this.http, workflow, limit, projectId);
  }

  getRunDetail(id: string, projectId?: string): Promise<RunDetail> {
    return core.getRunDetail(this.http, id, projectId);
  }

  getApprovals(): Promise<{ approvals: Approval[] }> {
    return approvals.getApprovals(this.http);
  }

  approve(id: string, note?: string): Promise<{ approval: Approval }> {
    return approvals.approveApproval(this.http, id, note);
  }

  reject(id: string, reason?: string): Promise<{ approval: Approval }> {
    return approvals.rejectApproval(this.http, id, reason);
  }

  getTasks(): Promise<TasksResponse> {
    return tasks.getTasks(this.http);
  }

  getOwnerQuestions(): Promise<{ questions: OwnerQuestion[] }> {
    return ownerQuestions.getOwnerQuestions(this.http);
  }

  answerOwnerQuestion(
    id: string,
    answer: string,
  ): Promise<{ question: OwnerQuestion }> {
    return ownerQuestions.answerOwnerQuestion(this.http, id, answer);
  }

  dismissOwnerQuestion(
    id: string,
    reason?: string,
  ): Promise<{ question: OwnerQuestion }> {
    return ownerQuestions.dismissOwnerQuestion(this.http, id, reason);
  }

  getDigest(): Promise<DigestResponse> {
    return digest.getDigest(this.http);
  }

  getAttention(): Promise<AttentionResponse> {
    return attention.getAttention(this.http);
  }

  searchKnowledge(query: string, limit = 10): Promise<KnowledgeSearchResponse> {
    return knowledge.searchKnowledge(this.http, query, limit);
  }

  searchMemory(query: string, limit = 10): Promise<MemorySearchResponse> {
    return memory.searchMemory(this.http, query, limit);
  }

  searchHistory(query: string, limit = 10): Promise<HistorySearchResponse> {
    return history.searchHistory(this.http, query, limit);
  }

  searchTasks(query: string, limit = 10): Promise<TasksSearchResponse> {
    return repoTasks.searchTasks(this.http, query, limit);
  }

  recall(
    query: string,
    options: RecallFilter = {},
  ): Promise<RecallSearchResponse> {
    return recallNs.recall(this.http, query, options);
  }

  answer(query: string, options: AnswerFilter = {}): Promise<AnswerResult> {
    return answerNs.answer(this.http, query, options);
  }

  answerLog(
    filter: AnswerHistoryListFilter = {},
  ): Promise<AnswerHistoryListResult> {
    return answerNs.answerLog(this.http, filter);
  }

  answerShow(id: string): Promise<AnswerHistoryShowResult> {
    return answerNs.answerShow(this.http, id);
  }

  capture(text: string, options: CaptureFilter = {}): Promise<CaptureResult> {
    return captureNs.capture(this.http, text, options);
  }

  retract(request: RetractRequest): Promise<RetractResult> {
    return retractNs.retract(this.http, request);
  }

  registerPushToken(deviceId: string, token: string): Promise<{ ok: boolean }> {
    return push.registerPushToken(this.http, deviceId, token);
  }

  pauseDispatch(projectId?: string): Promise<{ ok: boolean; paused: boolean }> {
    return core.pauseDispatch(this.http, projectId);
  }

  resumeDispatch(projectId?: string): Promise<{ ok: boolean; paused: boolean }> {
    return core.resumeDispatch(this.http, projectId);
  }

  getSessions(projectId?: string): Promise<{ sessions: InteractiveSession[] }> {
    return sessions.getSessions(this.http, projectId);
  }

  createSession(
    autonomyMode?: AutonomyMode,
    projectId?: string,
  ): Promise<{ session_id: string; autonomy_mode?: AutonomyMode }> {
    return sessions.createSession(this.http, autonomyMode, projectId);
  }

  setSessionAutonomyMode(
    id: string,
    mode: AutonomyMode,
    projectId?: string,
  ): Promise<SetAutonomyModeResponse> {
    return sessions.setSessionAutonomyMode(this.http, id, mode, projectId);
  }

  deleteSession(id: string, projectId?: string): Promise<void> {
    return sessions.deleteSession(this.http, id, projectId);
  }

  voiceTranscribe(input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResult> {
    return voice.voiceTranscribe(this.http, input);
  }

  voiceSynthesize(input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResult> {
    return voice.voiceSynthesize(this.http, input);
  }

  chatUrl(sessionId: string): string {
    return sessions.chatUrl(this.http, sessionId);
  }

  sseUrl(since?: string): string {
    return sessions.sseUrl(this.http, since);
  }

  get authHeader(): string {
    return `Bearer ${this.http.token}`;
  }
}
