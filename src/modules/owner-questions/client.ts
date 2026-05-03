/**
 * Owner-questions namespace client contract.
 *
 * The owner-questions module owns its KotaClient namespace surface
 * end-to-end: this file declares the per-namespace filter, list, and
 * mutate-result types and the `OwnerQuestionsClient` interface that the
 * `KotaClient` aggregate composes. Both the local-side handler
 * (`localClient(ctx)` in `index.ts`) and the daemon-side handler
 * (`daemonClient(link)` in `index.ts`) realize this contract; the
 * `kota owner-question` CLI consumes it through `ctx.client.ownerQuestions`.
 *
 * `OwnerQuestionStatus` and `PendingOwnerQuestion` are imported from
 * `#core/daemon/owner-question-queue.js` because the queue itself is a
 * daemon-shared runtime primitive that stays in core.
 */

import type {
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";

/**
 * Filter for `OwnerQuestionsClient.list`.
 *
 * `status` defaults to `"pending"` so the common "what's blocking the owner?"
 * call stays a one-liner. Pass a specific resolved status (`"answered"`,
 * `"dismissed"`, `"expired"`) or `"all"` to include resolved items used by
 * `kota owner-question history` and any caller that needs the full archive.
 */
export type OwnerQuestionListFilter = {
  status?: OwnerQuestionStatus | "all";
};

export type OwnerQuestionsListResult = {
  questions: PendingOwnerQuestion[];
};

/** Result of an owner-question mutation (`answer`, `dismiss`). */
export type OwnerQuestionMutateResult =
  | { ok: true; question: PendingOwnerQuestion }
  | { ok: false; reason: "not_found" };

/**
 * Owner-question queue operations.
 *
 * `list` reads the queue (filterable by status). `answer` resolves a pending
 * question with the operator's answer; `dismiss` resolves a pending question
 * without a substantive answer. Both mutations return the resolved question
 * so callers can render attribution (`resolutionSource`, `resolvedAt`) or
 * surface follow-up details. Resolved-question history (CLI `history --since`,
 * `--status`, `-n`) is composed from `list({ status: "all" })` plus CLI-side
 * filtering — the contract carries the queue snapshot, not the filter
 * derivation.
 */
export interface OwnerQuestionsClient {
  list(filter?: OwnerQuestionListFilter): Promise<OwnerQuestionsListResult>;
  answer(id: string, answer: string): Promise<OwnerQuestionMutateResult>;
  dismiss(id: string, reason?: string): Promise<OwnerQuestionMutateResult>;
}
