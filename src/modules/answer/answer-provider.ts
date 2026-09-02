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
 * After every call (success or failure) the provider appends one record
 * to the injected `AnswerHistorySink`. Persistence runs after the
 * envelope is computed so a failing append cannot alter the operator-
 * visible response — the only externally visible side effect of a sink
 * failure is a logged warning routed through `onPersistError`.
 *
 * The provider never re-runs recall, never fans out to a second model
 * call beyond the one allowed retry, and never silently keeps a marker
 * that does not resolve against the typed hit pile.
 */

import type { RecallHit } from "#modules/recall/client.js";
import {
  type AnswerHistoryStore,
  buildAnswerHistoryRecord,
  mintAnswerHistoryId,
} from "./answer-history-store.js";
import {
  ANSWER_DEFAULT_TOP_K,
  type AnswerRecallSeam,
  type AnswerScopeContext,
  AnswerScopeSelectionError,
  type ResolveAnswerScopeContext,
  type Synthesizer,
} from "./answer-types.js";
import { parseCitations, selectCitedHits } from "./citation-parser.js";
import type {
  AnswerClient,
  AnswerFilter,
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryShowFilter,
  AnswerHistoryShowResult,
  AnswerResult,
} from "./client.js";

export type AnswerProviderOptions = {
  recall: AnswerRecallSeam;
  synthesizer: Synthesizer;
  history: AnswerHistoryStore;
  resolveScopeContext?: ResolveAnswerScopeContext;
  /**
   * Optional callback fired when the synthesizer throws or returns
   * malformed output that survives the retry. Defaults to silent —
   * the caller already sees `synthesis_failed`. Tests inject a
   * recorder to assert on the failure path.
   */
  onSynthesisError?: (error: unknown) => void;
  /**
   * Optional callback fired when the history sink fails. Defaults to
   * silent. The wired module passes this to the module-context warn
   * channel so the operator sees the failure without the answer call
   * itself rejecting.
   */
  onPersistError?: (error: unknown) => void;
};

export class AnswerProviderImpl implements AnswerClient {
  private readonly recall: AnswerRecallSeam;
  private readonly synthesize: Synthesizer;
  private readonly history: AnswerHistoryStore;
  private readonly resolveScopeContext: ResolveAnswerScopeContext | undefined;
  private readonly onSynthesisError: (error: unknown) => void;
  private readonly onPersistError: (error: unknown) => void;

  constructor(options: AnswerProviderOptions) {
    this.recall = options.recall;
    this.synthesize = options.synthesizer;
    this.history = options.history;
    this.resolveScopeContext = options.resolveScopeContext;
    this.onSynthesisError = options.onSynthesisError ?? (() => {});
    this.onPersistError = options.onPersistError ?? (() => {});
  }

  async answer(
    query: string,
    filter?: AnswerFilter,
  ): Promise<AnswerResult> {
    const scope = this.scopeFor(filter?.scopeId);
    const trimmed = query.trim();
    const recallFilter: AnswerFilter = {
      ...filter,
      topK: filter?.topK ?? ANSWER_DEFAULT_TOP_K,
    };

    if (trimmed === "") {
      return this.persistAndReturn(
        query,
        recallFilter,
        [],
        {
          ok: false,
          reason: "no_hits",
        },
        scope,
      );
    }

    const recallResult = await this.recall.recall(trimmed, recallFilter);
    if (!recallResult.ok) {
      return this.persistAndReturn(query, recallFilter, [], {
        ok: false,
        reason: recallResult.reason,
      }, scope);
    }
    const hits = recallResult.hits;
    if (hits.length === 0) {
      return this.persistAndReturn(query, recallFilter, [], {
        ok: false,
        reason: "no_hits",
      }, scope);
    }

    const firstAttempt = await this.runSynthesis(trimmed, hits, false);
    if (firstAttempt.ok) {
      return this.persistAndReturn(
        query,
        recallFilter,
        hits,
        firstAttempt.result,
        scope,
      );
    }

    if (firstAttempt.kind === "thrown") {
      this.onSynthesisError(firstAttempt.error);
      return this.persistAndReturn(query, recallFilter, hits, {
        ok: false,
        reason: "synthesis_failed",
      }, scope);
    }

    const retry = await this.runSynthesis(trimmed, hits, true);
    if (retry.ok) {
      return this.persistAndReturn(
        query,
        recallFilter,
        hits,
        retry.result,
        scope,
      );
    }
    if (retry.kind === "thrown") this.onSynthesisError(retry.error);
    else this.onSynthesisError(new Error(`malformed citations: ${retry.unknown.join(", ")}`));
    return this.persistAndReturn(query, recallFilter, hits, {
      ok: false,
      reason: "synthesis_failed",
    }, scope);
  }

  async log(filter?: AnswerHistoryListFilter): Promise<AnswerHistoryListResult> {
    const scope = this.scopeFor(filter?.scopeId);
    return { entries: await (scope?.history ?? this.history).listAnswers(filter) };
  }

  async show(
    id: string,
    scopeFilter?: AnswerHistoryShowFilter,
  ): Promise<AnswerHistoryShowResult> {
    const scope = this.scopeFor(scopeFilter?.scopeId);
    const record = await (scope?.history ?? this.history).getAnswer(id);
    return record
      ? { ok: true, record }
      : { ok: false, reason: "not_found" };
  }

  private scopeFor(scopeId: string | undefined): AnswerScopeContext | undefined {
    const resolved = this.resolveScopeContext?.(scopeId);
    if (resolved && "error" in resolved) {
      throw new AnswerScopeSelectionError(resolved.scopeId);
    }
    return resolved;
  }

  private async persistAndReturn(
    query: string,
    filter: AnswerFilter,
    recallHits: RecallHit[],
    result: AnswerResult,
    scope?: AnswerScopeContext,
  ): Promise<AnswerResult> {
    try {
      const history = scope?.history ?? this.history;
      await history.appendAnswer(
        buildAnswerHistoryRecord({
          id: mintAnswerHistoryId(),
          createdAt: new Date().toISOString(),
          query,
          filter,
          recallHits,
          result,
        }),
      );
    } catch (error) {
      this.onPersistError(error);
    }
    return result;
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
