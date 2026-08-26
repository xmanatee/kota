/**
 * Canonical composition root for daemon values shared by thin clients.
 *
 * Domain owners continue to author their own result types. The binding
 * generator starts here so transport validation, web/mobile TypeScript, and
 * Swift all derive from those owner types instead of maintaining mirrors.
 * Keep transport-only envelopes here; do not copy module domain models here.
 */

import type { CapabilityReadinessResponse } from "#core/daemon/capability-readiness.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type { ScopePolicyRouteResponse } from "#core/daemon/scope-policy-types.js";
import type { ScopeRegistryProjection } from "#core/daemon/scope-registry.js";
import type { ModuleSetupStatusResponse } from "#core/modules/setup-requirements/types.js";
import type { AnswerHistoryListResult, AnswerHistoryShowResult, AnswerResult } from "#modules/answer/client.js";
import type { RenderedAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import type { DailyDigestData } from "#modules/autonomy/workflows/daily-digest/aggregate.js";
import type { CaptureResult } from "#modules/capture/client.js";
import type { HistorySearchResult } from "#modules/history/client.js";
import type { KnowledgeSearchResult } from "#modules/knowledge/client.js";
import type { MemorySearchResult } from "#modules/memory/client.js";
import type { RecallResult } from "#modules/recall/client.js";
import type { RepoTaskSearchResult } from "#modules/repo-tasks/client.js";
import type { RetractResult } from "#modules/retract/client.js";

export type UnknownScopeError = {
  error: string;
  reason: "unknown_scope";
  scopeId: string;
};

export type DigestResponse = {
  data: DailyDigestData;
  text: string;
};

/** JSON response from the web voice adapter; binary success remains native. */
export type VoiceFailure = {
  ok: false;
  status: number;
  error: string;
  code:
    | "stt-unavailable"
    | "stt-failed"
    | "tts-unavailable"
    | "tts-failed"
    | "tts-format-unsupported";
  supported?: string[];
};

export type VoiceTranscribeSuccess = {
  ok: true;
  text: string;
  language?: string;
};

export type VoiceTranscribeResponse = VoiceTranscribeSuccess | VoiceFailure;

/**
 * One schema root for all shared JSON response families. Property names are
 * stable binding ids referenced by the authored route graph.
 */
export type DaemonWireContract = {
  identity: ClientIdentity;
  scopeRegistry: ScopeRegistryProjection;
  scopePolicy: ScopePolicyRouteResponse;
  unknownScopeError: UnknownScopeError;
  capabilities: CapabilityReadinessResponse;
  setupStatus: ModuleSetupStatusResponse;
  recall: RecallResult;
  answer: AnswerResult;
  answerHistoryList: AnswerHistoryListResult;
  answerHistoryShow: AnswerHistoryShowResult;
  capture: CaptureResult;
  retract: RetractResult;
  knowledgeSearch: KnowledgeSearchResult;
  memorySearch: MemorySearchResult;
  historySearch: HistorySearchResult;
  tasksSearch: RepoTaskSearchResult;
  attention: RenderedAttention;
  digest: DigestResponse;
  voiceTranscribe: VoiceTranscribeResponse;
  voiceFailure: VoiceFailure;
};
