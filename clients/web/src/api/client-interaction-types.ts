import type {
  CaptureTarget,
  RecallSource,
  RetractTarget,
} from "../../../conformance/decoders";

/** Cross-client response contracts decoded at the HTTP boundary. */
export {
  ContractDecodeError,
  parseScopeRegistryProjection,
  parseUnknownScopeError,
} from "../../../conformance/decoders";

export type {
  AnswerCitation,
  AnswerHistoryEntry,
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
  AttentionItem,
  AttentionResponse,
  CaptureRecord,
  CaptureResult,
  CaptureTarget,
  DigestData,
  DigestQueueCounts,
  DigestQueueDelta,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeEntry,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  RecallAnswerHit,
  RecallAnswerHitResult,
  RecallHistoryHit,
  RecallHit,
  RecallKnowledgeHit,
  RecallMemoryHit,
  RecallResult,
  RecallSource,
  RecallTasksHit,
  RetractRecord,
  RetractResult,
  RetractTarget,
  TasksSearchResponse,
} from "../../../conformance/decoders";

export type AnswerFilter = {
  topK?: number;
  minScore?: number;
  sources?: RecallSource[];
};

export type AnswerHistoryListFilter = {
  limit?: number;
  beforeId?: string;
};

export type CaptureFilter = {
  target?: CaptureTarget;
  hint?: string;
};

export type RetractRequest =
  | { target: "memory"; id: string }
  | { target: "knowledge"; slug: string }
  | { target: "tasks"; id: string }
  | { target: "inbox"; path: string };

export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  "memory",
  "knowledge",
  "tasks",
  "inbox",
] as const;

export type SlashCommandSource = "workflow" | "skill";

export type SlashCommand = {
  name: string;
  label: string;
  description?: string;
  source: SlashCommandSource;
  module: string;
};

export type SlashCommandInvocation =
  | { kind: "workflow"; queued: string; runId?: string }
  | { kind: "skill"; prompt: string };

export type DaemonSseEventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.step.completed"
  | "queue.changed"
  | "approval.changed"
  | "task.changed"
  | "session.registered"
  | "session.unregistered"
  | "workflow.failure.alert"
  | "owner.question.asked"
  | "owner.question.changed"
  | "owner.question.resolved"
  | "owner.question.dismissed"
  | "owner.question.expired";
