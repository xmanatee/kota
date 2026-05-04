/**
 * Recall namespace client contract.
 *
 * The recall module owns its KotaClient namespace surface end-to-end:
 * this file declares the source/hit/filter/result types and the
 * `RecallClient` interface that the `KotaClient` aggregate composes.
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota recall` CLI, the `recall` agent tool, the route
 * handler, the contributors, the system-prompt provider, and the
 * provider implementation all consume it through `ctx.client.recall` or
 * by importing these types from `#modules/recall/client.js`.
 */

/**
 * Source of a `RecallHit`. The cross-store recall seam discriminates each hit
 * by which store originated it. Adding a new contributor extends this union
 * and the `RecallHit` discriminated type below.
 *
 * `answer` carries the assistant's own prior cited-answer envelopes — every
 * `AnswerProvider.answer` call appends a record to the answer-history store,
 * and the answer module registers a recall contributor over that store so a
 * fact-shaped follow-up turn can ground in prior synthesized answers
 * alongside the raw `knowledge` / `memory` / `history` / `tasks` stores.
 */
export type RecallSource =
  | "knowledge"
  | "memory"
  | "history"
  | "tasks"
  | "answer";

/** Knowledge-store hit payload surfaced through `recall`. */
export type RecallKnowledgeHit = {
  source: "knowledge";
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
};

/** Memory-store hit payload surfaced through `recall`. */
export type RecallMemoryHit = {
  source: "memory";
  score: number;
  id: string;
  preview: string;
  created: string;
};

/** Conversation-history hit payload surfaced through `recall`. */
export type RecallHistoryHit = {
  source: "history";
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
};

/** Repo-task-queue hit payload surfaced through `recall`. */
export type RecallTasksHit = {
  source: "tasks";
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
};

/**
 * Prior-answer envelope hit payload surfaced through `recall`.
 *
 * The hit is the persistent shadow of a prior `AnswerProvider.answer(query)`
 * call. `query` is the original operator question that produced the
 * envelope; `preview` is a clipped view of the synthesized answer text on
 * the success arm or the failure reason on the failure arm; `citationCount`
 * is the size of the typed `[source:id]` citation list the synthesizer
 * resolved (zero on failure); `result` mirrors the discriminated success/
 * failure shape stored in the `AnswerHistoryRecord` so a consumer can show
 * an operator that the prior answer failed instead of treating every prior
 * envelope as a usable citation source.
 */
export type RecallAnswerHit = {
  source: "answer";
  score: number;
  id: string;
  query: string;
  preview: string;
  citationCount: number;
  createdAt: string;
  result:
    | { ok: true }
    | {
        ok: false;
        reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
      };
};

/**
 * One ranked, source-tagged hit returned by the cross-store recall seam.
 * Discriminated by `source`; the per-source payload carries the operator-
 * facing metadata each surface renders.
 */
export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit
  | RecallAnswerHit;

/**
 * Filter accepted by `RecallClient.recall`. All fields are optional with
 * explicit defaults applied at the seam:
 *
 * - `topK` defaults to 20.
 * - `minScore` defaults to 0 (no floor).
 * - `sources` defaults to "every registered contributor"; pass a list to
 *   restrict to a subset (e.g. `["knowledge", "memory"]`).
 */
export type RecallFilter = {
  topK?: number;
  minScore?: number;
  sources?: ReadonlyArray<RecallSource>;
};

/**
 * Result of `recall.recall`.
 *
 * The seam tolerates partial contributor failure: when one contributor cannot
 * answer (no semantic backend, hard error during query) it contributes zero
 * hits and the rest still return under `ok: true`.
 *
 * The discriminated `ok: false` branch only fires when the seam itself has no
 * registered contributors — i.e. cross-store recall is genuinely unconfigured.
 * Callers branch on `ok` to tell "nothing matched" (`ok: true` with empty
 * `hits`) from "the seam is not configured" (`ok: false`), matching the
 * per-store search surfaces.
 */
export type RecallResult =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: "semantic_unavailable" };

/**
 * Cross-store recall operations.
 *
 * `recall(query, filter?)` answers "what do I know / remember / have done /
 * am tracking / have already answered about X?" with one ranked, source-
 * tagged list across every registered contributor. Sources currently
 * include the four raw stores — `knowledge`, `memory`, `history`, `tasks`
 * — plus `answer`, the assistant's prior cited-answer envelopes. The seam
 * normalizes scores once across hits from each contributor and merges them
 * deterministically; tie-breaking is stable so repeated queries return
 * identical orderings.
 */
export interface RecallClient {
  recall(query: string, filter?: RecallFilter): Promise<RecallResult>;
}
