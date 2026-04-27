/**
 * AnswerProviderImpl — cited synthesis on top of the recall seam.
 *
 * The provider:
 * 1. Calls the recall seam.
 * 2. Forwards `semantic_unavailable` verbatim and surfaces empty hits
 *    as `no_hits`.
 * 3. Asks the synthesizer to compose one short answer with inline
 *    `[source:id]` citation markers drawn from the typed hit list.
 * 4. Parses the model output. Unknown citation markers trigger ONE
 *    retry instructing the model to restrict to the available pairs.
 * 5. Surfaces a synthesizer throw or post-retry malformed citation as
 *    `synthesis_failed`.
 *
 * The provider never re-runs recall, never fans out to a second model
 * call beyond the one allowed retry, and never silently keeps a marker
 * that does not resolve against the typed hit pile.
 */

import type { AnswerFilter, AnswerResult } from "#core/server/kota-client.js";
import {
  ANSWER_DEFAULT_TOP_K,
  type AnswerProvider,
  type AnswerRecallSeam,
  type Synthesizer,
} from "./answer-types.js";
import { parseCitations, selectCitedHits } from "./citation-parser.js";

export type AnswerProviderOptions = {
  recall: AnswerRecallSeam;
  synthesizer: Synthesizer;
  /**
   * Optional callback fired when the synthesizer throws or returns
   * malformed output that survives the retry. Defaults to silent —
   * the caller already sees `synthesis_failed`. Tests inject a
   * recorder to assert on the failure path.
   */
  onSynthesisError?: (error: unknown) => void;
};

export class AnswerProviderImpl implements AnswerProvider {
  private readonly recall: AnswerRecallSeam;
  private readonly synthesize: Synthesizer;
  private readonly onSynthesisError: (error: unknown) => void;

  constructor(options: AnswerProviderOptions) {
    this.recall = options.recall;
    this.synthesize = options.synthesizer;
    this.onSynthesisError = options.onSynthesisError ?? (() => {});
  }

  async answer(query: string, filter?: AnswerFilter): Promise<AnswerResult> {
    const trimmed = query.trim();
    if (trimmed === "") {
      return { ok: false, reason: "no_hits" };
    }

    const recallFilter: AnswerFilter = {
      ...filter,
      topK: filter?.topK ?? ANSWER_DEFAULT_TOP_K,
    };
    const recallResult = await this.recall.recall(trimmed, recallFilter);
    if (!recallResult.ok) {
      return { ok: false, reason: recallResult.reason };
    }
    const hits = recallResult.hits;
    if (hits.length === 0) {
      return { ok: false, reason: "no_hits" };
    }

    const firstAttempt = await this.runSynthesis(trimmed, hits, false);
    if (firstAttempt.ok) return firstAttempt.result;

    if (firstAttempt.kind === "thrown") {
      this.onSynthesisError(firstAttempt.error);
      return { ok: false, reason: "synthesis_failed" };
    }

    const retry = await this.runSynthesis(trimmed, hits, true);
    if (retry.ok) return retry.result;
    if (retry.kind === "thrown") this.onSynthesisError(retry.error);
    else this.onSynthesisError(new Error(`malformed citations: ${retry.unknown.join(", ")}`));
    return { ok: false, reason: "synthesis_failed" };
  }

  private async runSynthesis(
    query: string,
    hits: AnswerSynthesisHits,
    retry: boolean,
  ): Promise<RunResult> {
    let raw: string;
    try {
      raw = await this.synthesize({ query, hits, retry });
    } catch (error) {
      return { ok: false, kind: "thrown", error };
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      return { ok: false, kind: "malformed", unknown: ["<empty>"] };
    }
    const parsed = parseCitations(trimmed, hits);
    if (parsed.unknownMarkers.length > 0) {
      return { ok: false, kind: "malformed", unknown: parsed.unknownMarkers };
    }
    if (parsed.citations.length === 0) {
      return { ok: false, kind: "malformed", unknown: ["<no markers>"] };
    }
    return {
      ok: true,
      result: {
        ok: true,
        answer: trimmed,
        citations: parsed.citations,
        hits: selectCitedHits(parsed.citations, hits),
      },
    };
  }
}

type AnswerSynthesisHits = Parameters<Synthesizer>[0]["hits"];

type RunResult =
  | { ok: true; result: Extract<AnswerResult, { ok: true }> }
  | { ok: false; kind: "thrown"; error: unknown }
  | { ok: false; kind: "malformed"; unknown: string[] };
