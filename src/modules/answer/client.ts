/**
 * Answer namespace client contract.
 *
 * The answer module owns its KotaClient namespace surface end-to-end:
 * this file declares the answer-namespace types (filter, citation, result,
 * persisted record/entry, history list/show shapes), the `AnswerClient`
 * interface that the `KotaClient` aggregate composes, and the strict
 * decoders the daemon-side handler runs over the daemon-up wire shape
 * for `GET /answers` and `GET /answers/:id`.
 *
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota answer` CLI, the `answer` agent tool, the route
 * handlers, the answer-history store, the answer provider, the recall
 * contributor, and the renderer all consume it through `ctx.client.answer`
 * or by importing these types from `#modules/answer/client.js`.
 *
 * `RecallFilter`, `RecallHit`, and `RecallSource` are imported from
 * `#core/server/kota-client.js` because the recall namespace is not yet
 * migrated. Once the recall migration lands, these imports follow the
 * "each migration moves only its own namespace types" rule and shift on
 * their own.
 */

import type {
  RecallFilter,
  RecallHit,
  RecallSource,
} from "#core/server/kota-client.js";

/**
 * Filter accepted by `AnswerClient.answer`. Forwarded to the underlying
 * recall fan-out so callers can shrink the source pile the synthesizer
 * sees. All fields share defaults with `RecallFilter`.
 */
export type AnswerFilter = RecallFilter;

/**
 * Typed citation marker emitted by the answer seam. Each citation is
 * keyed by the same `{ source, id }` discriminator as the underlying
 * `RecallHit`, so the response is always reconstructable against the
 * `hits` list — no free-form prose pointers, no hallucinated sources.
 */
export type AnswerCitation = {
  source: RecallSource;
  id: string;
};

/**
 * Result of `answer.answer`.
 *
 * `ok: true` carries one short composed answer with structured citations
 * and the typed `RecallHit[]` they resolve against (a strict subset of the
 * recall result the seam consumed).
 *
 * `ok: false` discriminates the three non-trivial failure modes:
 *
 * - `no_hits` — recall returned zero hits; nothing to synthesize.
 * - `semantic_unavailable` — recall itself is unconfigured (forwarded
 *   verbatim from the recall seam).
 * - `synthesis_failed` — the model call failed or produced malformed
 *   citations that survived the single allowed retry.
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
      reason: "no_hits" | "semantic_unavailable" | "synthesis_failed";
    };

/**
 * Persisted record of one `AnswerProvider.answer(query, filter?)` call.
 *
 * One record per call regardless of `ok`. The record carries the original
 * query verbatim, the post-default filter actually used, the typed
 * `RecallHit[]` the synthesizer was shown (or what recall returned for
 * `ok: false` arms that never reached the synthesizer), and the
 * discriminated `AnswerResult` envelope the caller saw. The shape is
 * the eval-harness corpus seam — every fixture authored from this store
 * is a strict subset of these fields.
 */
export type AnswerHistoryRecord = {
  id: string;
  createdAt: string;
  query: string;
  filter: AnswerFilter;
  recallHits: RecallHit[];
  result: AnswerResult;
};

/**
 * Compact projection of `AnswerHistoryRecord` for list rendering. The
 * projection is closed over the discriminated `result` shape so callers
 * cannot accidentally read fields that only exist on the `ok: true`
 * branch.
 */
export type AnswerHistoryEntry = {
  id: string;
  createdAt: string;
  query: string;
  result:
    | { ok: true; citationCount: number }
    | { ok: false; reason: "no_hits" | "semantic_unavailable" | "synthesis_failed" };
};

/**
 * Filter accepted by `AnswerClient.log`. Both fields are optional; the
 * store applies its own defaults (newest-first, capped page size). The
 * `beforeId` cursor is the `id` of the last entry on the previous page
 * — passing it returns the next older entries.
 */
export type AnswerHistoryListFilter = {
  limit?: number;
  beforeId?: string;
};

/** Result of `AnswerClient.log`. */
export type AnswerHistoryListResult = {
  entries: AnswerHistoryEntry[];
};

/**
 * Result of `AnswerClient.show`. Discriminated so the caller cannot read
 * `record` when the id was not found.
 */
export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: "not_found" };

/**
 * Cited-answer operations.
 *
 * `answer(query, filter?)` runs the cross-store recall fan-out and asks
 * the model for one short composed answer with typed `[source:id]`
 * citation markers anchored back to the typed `RecallHit`s. The
 * synthesizer retries once on malformed-citation output before
 * surfacing `synthesis_failed` — never multiple silent calls per query.
 *
 * `log(filter?)` and `show(id)` read back persisted answer envelopes so
 * the operator can re-render past synthesized answers and the eval-
 * harness can pull a real-failure corpus. Every `answer(...)` call
 * appends one record; reads are strict against the typed shapes above.
 */
export interface AnswerClient {
  answer(query: string, filter?: AnswerFilter): Promise<AnswerResult>;
  log(filter?: AnswerHistoryListFilter): Promise<AnswerHistoryListResult>;
  show(id: string): Promise<AnswerHistoryShowResult>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Strict decoder for `GET /answers` responses. Rejects loud rather than
 * silently dropping malformed shapes — same discipline the answer
 * synthesizer envelope already follows.
 */
export function decodeAnswerHistoryListResult(
  value: unknown,
): AnswerHistoryListResult {
  if (!isObject(value)) {
    throw new Error("Malformed answer history list payload: not an object");
  }
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new Error("Malformed answer history list payload: entries not an array");
  }
  for (const entry of entries) {
    if (!isObject(entry)) {
      throw new Error("Malformed answer history entry: not an object");
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.id !== "string") {
      throw new Error("Malformed answer history entry: missing id");
    }
    if (typeof obj.createdAt !== "string") {
      throw new Error("Malformed answer history entry: missing createdAt");
    }
    if (typeof obj.query !== "string") {
      throw new Error("Malformed answer history entry: missing query");
    }
    const result = obj.result as { ok?: unknown } | undefined;
    if (!result || typeof result.ok !== "boolean") {
      throw new Error("Malformed answer history entry: missing result.ok");
    }
  }
  return value as AnswerHistoryListResult;
}

/** Strict decoder for `GET /answers/:id` responses. */
export function decodeAnswerHistoryShowResult(
  value: unknown,
): AnswerHistoryShowResult {
  if (!isObject(value)) {
    throw new Error("Malformed answer history show payload: not an object");
  }
  const obj = value as { ok?: unknown };
  if (obj.ok === false) {
    const reason = (value as { reason?: unknown }).reason;
    if (reason !== "not_found") {
      throw new Error(`Malformed answer history show payload: reason=${String(reason)}`);
    }
    return { ok: false, reason: "not_found" };
  }
  if (obj.ok === true) {
    const record = (value as { record?: unknown }).record;
    if (!isObject(record)) {
      throw new Error("Malformed answer history show payload: missing record");
    }
    const r = record as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.createdAt !== "string" ||
      typeof r.query !== "string"
    ) {
      throw new Error("Malformed answer history record: missing core fields");
    }
    return value as AnswerHistoryShowResult;
  }
  throw new Error("Malformed answer history show payload: ok not boolean");
}
