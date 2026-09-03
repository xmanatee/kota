import type { PendingApprovalMessage } from "./callback-poll.js";
import type { PendingMessage } from "./owner-question-reply.js";

export interface TelegramRuntimeState {
  readonly pendingApprovalMessages: Map<string, PendingApprovalMessage>;
  readonly pendingOwnerQuestionMessages: Map<string, PendingMessage>;
  readonly reportedPollConflicts: Set<string>;
}

export function createTelegramRuntimeState(): TelegramRuntimeState {
  return {
    pendingApprovalMessages: new Map(),
    pendingOwnerQuestionMessages: new Map(),
    reportedPollConflicts: new Set(),
  };
}
