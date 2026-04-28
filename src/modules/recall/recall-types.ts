/**
 * Recall seam — typed protocol for cross-store retrieval.
 *
 * `RecallContributor` is what each store implements. Contributors return
 * raw, source-tagged hits with their native scoring; the seam normalizes
 * once across each contributor's batch and merges deterministically.
 *
 * `RecallProvider` is the seam consumers see. It does not know the set of
 * contributors at type-time — `register` accepts N typed contributors, so
 * adding a fifth store is a registration, not an enum edit.
 */
import type {
  RecallFilter,
  RecallHit,
  RecallSource,
} from "#core/server/kota-client.js";

export type {
  RecallAnswerHit,
  RecallFilter,
  RecallHistoryHit,
  RecallHit,
  RecallKnowledgeHit,
  RecallMemoryHit,
  RecallResult,
  RecallSource,
  RecallTasksHit,
} from "#core/server/kota-client.js";

/**
 * Stable source ordering used as a tertiary sort key after score and id.
 * Adding a new source extends `RecallSource` and the discriminated `RecallHit`
 * union; it does not require editing this constant unless the operator wants
 * the new source's tie-break position to differ from the alphabetical default.
 *
 * `answer` is intentionally last: when a raw-store hit and a prior cited-
 * answer hit normalize to the same score, the raw-store evidence wins the
 * tie so the synthesizer prefers grounding in the underlying source it
 * could already have cited directly.
 */
export const RECALL_SOURCE_ORDER: ReadonlyArray<RecallSource> = [
  "knowledge",
  "memory",
  "tasks",
  "history",
  "answer",
] as const;

/**
 * Defaults applied at the seam when the caller does not supply a filter
 * field. Kept here so contributors never see `undefined` defaults.
 */
export const RECALL_DEFAULT_TOP_K = 20;

/**
 * Raw hit a contributor emits. The seam normalizes `nativeScore` once across
 * each contributor's batch and rewrites it into the merged `RecallHit`.
 *
 * `nativeScore` is the contributor's chosen relevance signal — cosine
 * similarity for embedding-backed contributors, weighted token count for
 * keyword fallbacks. The seam does not interpret the absolute value; it only
 * uses it for per-source relative ordering and min-max rescaling.
 */
export type RawRecallEntry =
  | {
      source: "knowledge";
      id: string;
      nativeScore: number;
      payload: { title: string; preview: string; updated: string };
    }
  | {
      source: "memory";
      id: string;
      nativeScore: number;
      payload: { preview: string; created: string };
    }
  | {
      source: "history";
      id: string;
      nativeScore: number;
      payload: { title: string; cwd: string; updatedAt: string };
    }
  | {
      source: "tasks";
      id: string;
      nativeScore: number;
      payload: {
        title: string;
        state: string;
        priority: string;
        updatedAt: string;
      };
    }
  | {
      source: "answer";
      id: string;
      nativeScore: number;
      payload: {
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
    };

/**
 * One contributor for the recall seam. The contributor owns how it answers a
 * query — semantic, keyword, hybrid — and reports any failure by returning
 * an empty array. The seam never re-throws a contributor error; partial
 * results are an explicit feature of the protocol.
 *
 * `topK` is the per-source cap; the seam asks each contributor for up to
 * `topK` hits before ranking and clipping to the global cap.
 */
export interface RecallContributor {
  readonly source: RecallSource;
  recall(
    query: string,
    options: { topK: number },
  ): Promise<RawRecallEntry[]>;
}

/**
 * The recall provider. `register` accepts any contributor; calling it twice
 * with the same source replaces the prior contributor for that source so
 * test harnesses and module reloads stay deterministic.
 *
 * `register` and `unregister` are the public registration seam any module
 * uses to contribute or withdraw a contributor from its own `onLoad` /
 * `onUnload`. The seam has exactly one shape — a sixth contributor follows
 * the same path. Modules reach the live `RecallProvider` through the
 * provider-registry seam (`ctx.getProvider<RecallProvider>("recall")`),
 * which the recall module populates during its own `onLoad` via
 * `ctx.registerProvider("recall", provider)`.
 */
export interface RecallProvider {
  register(contributor: RecallContributor): void;
  unregister(source: RecallSource): void;
  /** List currently-registered contributor sources, in registration order. */
  contributors(): ReadonlyArray<RecallSource>;
  recall(query: string, filter?: RecallFilter): Promise<RecallHit[]>;
}
