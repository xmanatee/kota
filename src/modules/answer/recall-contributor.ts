/**
 * Recall contributor for the persisted cited-answer envelope corpus.
 *
 * Owned by the answer module so the recall seam stays oblivious to the
 * store layout: the answer module is the only place that imports
 * `AnswerHistoryStore` and the only writer of `RecallAnswerHit` payloads.
 * The contributor is registered against the live `RecallProvider` from the
 * answer module's `onLoad` and is unregistered cleanly from `onUnload`.
 *
 * The contributor mirrors the recall module's keyword-fallback adapters:
 * native scores come from `searchAnswers`'s `[0, 1]` overlap signal so the
 * seam's per-source min-max normalization rescales them the same way it
 * rescales `KnowledgeProvider.search` and `MemoryProvider.search` results.
 * No second scoring strategy and no embedding plumbing — adding a real
 * semantic backend later swaps the provider layer without touching the
 * contributor seam.
 */
import type { RawRecallEntry, RecallContributor } from "#modules/recall/recall-types.js";
import {
  type AnswerHistoryStore,
  answerSearchPreview,
} from "./answer-history-store.js";
import type { ResolveAnswerProjectContext } from "./project-context.js";

export function createAnswerRecallContributor(
  store: AnswerHistoryStore,
  resolveProjectContext?: ResolveAnswerProjectContext,
): RecallContributor {
  return {
    source: "answer",
    async recall(query, { topK, project }) {
      const scoped =
        project && resolveProjectContext
          ? resolveProjectContext(project.projectId)
          : null;
      if (scoped && "error" in scoped) {
        throw new Error(`Unknown project: ${scoped.projectId}`);
      }
      const history = scoped?.history ?? store;
      const hits = await history.searchAnswers(query, { topK });
      return hits.map<RawRecallEntry>(({ record, score }) => ({
        source: "answer",
        id: record.id,
        nativeScore: score,
        payload: {
          query: record.query,
          preview: answerSearchPreview(record),
          citationCount: record.result.ok ? record.result.citations.length : 0,
          createdAt: record.createdAt,
          result: record.result.ok
            ? { ok: true }
            : { ok: false, reason: record.result.reason },
        },
      }));
    },
  };
}
