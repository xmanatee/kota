/**
 * Answer seam — typed protocol for cited synthesis on top of recall.
 *
 * The seam delegates retrieval to the recall provider; it does not define
 * a second contributor registry, embedding cache, or normalization rule.
 * One model call composes the answer from the typed `RecallHit[]` recall
 * returns, and the response is parsed back into structured citations
 * keyed by `{ source, id }`.
 */

import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type {
  AnswerCitation,
  AnswerFilter,
  AnswerResult,
  RecallFilter,
  RecallHit,
  RecallResult,
} from "#core/server/kota-client.js";

export type {
  AnswerCitation,
  AnswerFilter,
  AnswerResult,
} from "#core/server/kota-client.js";

/**
 * Hard cap on the typed citation list returned to the operator. Citations
 * past this point are dropped before validation. Mirrors the synthesis
 * prompt's "few sentences" target — an answer that needs more than this
 * many sources is asking the wrong question.
 */
export const ANSWER_MAX_CITATIONS = 8;

/**
 * Hard cap on the recall hit pile fed to the synthesizer. Larger piles
 * dilute attention without improving citation quality. The seam asks
 * recall for more than this only when the operator explicitly raises
 * `topK`; otherwise the synthesizer sees the top `ANSWER_DEFAULT_TOP_K`.
 */
export const ANSWER_DEFAULT_TOP_K = 8;

/**
 * Narrow recall surface the answer seam consumes. Matches `RecallClient`
 * exactly so the in-process recall provider and the daemon-link client
 * are both valid implementations. Keeping the seam abstract over the
 * full client lets unit tests inject a single function without stubbing
 * an unrelated namespace.
 */
export interface AnswerRecallSeam {
  recall(query: string, filter?: RecallFilter): Promise<RecallResult>;
}

/**
 * Synthesizer input. The model sees the operator query plus the typed
 * `RecallHit` pile. The pile is ordered by recall's score ranking so
 * the top-cited sources appear first in the prompt.
 */
export type SynthesisInput = {
  query: string;
  hits: RecallHit[];
  /**
   * Set when the previous synthesis call produced markers that did not
   * resolve against the hit pile. The retry pass instructs the model to
   * restrict its citations to the available `[source:id]` pairs only.
   */
  retry: boolean;
};

/**
 * Pluggable synthesizer. Returns the raw model output text — the seam
 * parses citation markers out of it. The function may throw; the seam
 * surfaces a thrown synthesizer as `synthesis_failed` after the single
 * allowed retry.
 */
export type Synthesizer = (input: SynthesisInput) => Promise<string>;

/**
 * Result of parsing the model output into prose plus typed citations.
 * `unknownMarkers` carries the `[source:id]` pairs that did not resolve
 * against the hit pile so the caller can decide between a retry and a
 * final `synthesis_failed`.
 */
export type ParsedSynthesis = {
  citations: AnswerCitation[];
  unknownMarkers: string[];
};

/** The owning provider seam. */
export interface AnswerProvider {
  answer(query: string, filter?: AnswerFilter): Promise<AnswerResult>;
}

/** Provider-registry token for the cited-answer seam. */
export const ANSWER_PROVIDER_TOKEN: ProviderToken<AnswerProvider> =
  defineProviderToken<AnswerProvider>("answer");
