import type { EventJournal } from "#core/events/event-journal.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { InteractiveSession } from "./daemon-control-types.js";
import type { DeadLetterQueueStore } from "./dead-letter-queue.js";
import type { IdempotencyStore } from "./idempotency-store.js";
import type { OwnerDecisionStore } from "./owner-decision-store.js";
import type { OwnerQuestionQueue } from "./owner-question-queue.js";
import type { ScopeRuntimeRegistry } from "./scope-runtime.js";

export type LifecycleCandidateDecision =
  | "keep"
  | "compact"
  | "delete"
  | "needs_attention";

export type LifecycleStoreName =
  | "sandboxes"
  | "git-branches"
  | "processes"
  | "sessions"
  | "chat-bindings"
  | "owner-records"
  | "idempotency"
  | "temporary-payloads"
  | "run-artifacts"
  | "event-journal"
  | "dead-letters"
  | "run-state-database";

export type LifecycleCandidate = {
  candidate: string;
  store: LifecycleStoreName;
  decision: LifecycleCandidateDecision;
  reason: string;
  age: number;
  owner: string;
  estimatedBytes: number;
  remediation?: string;
};

export type StoreReclamationSummary = {
  count: number;
  reclaimedBytes: number;
};

export type LifecycleSweepReport = {
  dryRun: boolean;
  candidates: LifecycleCandidate[];
  reclaimedByStore: Record<string, StoreReclamationSummary>;
  reclaimedCount: number;
  reclaimedBytes: number;
  completedAt: string;
};

export type LifecycleStatusReport = {
  candidates: LifecycleCandidate[];
  summary: {
    totalCandidates: number;
    byDecision: Record<LifecycleCandidateDecision, number>;
    estimatedReclaimableBytes: number;
  };
  completedAt: string;
};

export type LifecycleSweepOptions = {
  dryRun?: boolean;
  scopeId?: string;
  targetRunId?: string;
  now?: number | Date;
};

export type LifecycleStatusOptions = {
  scopeId?: string;
  now?: number | Date;
};

export type LifecycleScopeStores = {
  idempotencyStore?: IdempotencyStore;
  deadLetterQueue?: DeadLetterQueueStore;
  runStore?: WorkflowRunStore;
  ownerDecisionStore?: OwnerDecisionStore;
  ownerQuestionQueue?: OwnerQuestionQueue;
};

export type LifecycleCollectorDeps = {
  stateDir: string;
  scopeRegistry: {
    list(): readonly { scopeId: string; scopeRoot: string; displayName?: string }[];
    getDefaultScopeId(): string;
  };
  runState: RunStateDatabase;
  eventJournal?: EventJournal;
  sessions?: Map<string, InteractiveSession>;
  chatBindings?: DaemonChatBindingStore;
  emitSessionUnregistered?: (scopeId: string, sessionId: string) => void;
  sessionIdleTtlMs?: number;
  scopeRuntimes?: ScopeRuntimeRegistry;
  resolveScopeStores?: (scopeId: string) => LifecycleScopeStores;
  now?: () => Date;
  log?: (message: string) => void;
};
