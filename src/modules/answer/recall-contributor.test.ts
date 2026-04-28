import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnswerHistoryStore,
  buildAnswerHistoryRecord,
  DiskAnswerHistoryStore,
  mintAnswerHistoryId,
} from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import type { AnswerRecallSeam, Synthesizer } from "./answer-types.js";
import { createAnswerRecallContributor } from "./recall-contributor.js";

const HITS = [
  {
    source: "knowledge",
    score: 1,
    id: "k1",
    title: "Recall design",
    preview: "Cross-store recall normalizes once.",
    updated: "2026-04-26",
  },
] as const;

describe("createAnswerRecallContributor", () => {
  let rootDir: string;
  let store: AnswerHistoryStore;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-answer-contrib-"));
    store = new DiskAnswerHistoryStore({ rootDir });
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("registers the `answer` source", () => {
    const contributor = createAnswerRecallContributor(store);
    expect(contributor.source).toBe("answer");
  });

  it("returns no hits when the store is empty", async () => {
    const contributor = createAnswerRecallContributor(store);
    const hits = await contributor.recall("anything", { topK: 5 });
    expect(hits).toEqual([]);
  });

  it("surfaces a prior cited answer as a typed RawRecallEntry payload", async () => {
    const id = mintAnswerHistoryId();
    await store.appendAnswer(
      buildAnswerHistoryRecord({
        id,
        createdAt: "2026-04-27T10:00:00.000Z",
        query: "How does the recall seam rank hits?",
        filter: { topK: 8 },
        recallHits: [...HITS],
        result: {
          ok: true,
          answer:
            "Recall normalizes each source's native scores once and tie-breaks by source order [knowledge:k1].",
          citations: [{ source: "knowledge", id: "k1" }],
          hits: [...HITS],
        },
      }),
    );

    const contributor = createAnswerRecallContributor(store);
    const hits = await contributor.recall("recall rank hits", { topK: 5 });
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(hit.source).toBe("answer");
    if (hit.source !== "answer") throw new Error("type narrowing");
    expect(hit.id).toBe(id);
    expect(hit.nativeScore).toBeGreaterThan(0);
    expect(hit.payload.query).toBe("How does the recall seam rank hits?");
    expect(hit.payload.preview).toContain("normalizes");
    expect(hit.payload.citationCount).toBe(1);
    expect(hit.payload.result).toEqual({ ok: true });
    expect(hit.payload.createdAt).toBe("2026-04-27T10:00:00.000Z");
  });

  it("surfaces a prior failure envelope as a typed failure-arm payload", async () => {
    const id = mintAnswerHistoryId();
    await store.appendAnswer(
      buildAnswerHistoryRecord({
        id,
        createdAt: "2026-04-27T11:00:00.000Z",
        query: "What does the citation parser ignore?",
        filter: { topK: 8 },
        recallHits: [],
        result: { ok: false, reason: "synthesis_failed" },
      }),
    );

    const contributor = createAnswerRecallContributor(store);
    const hits = await contributor.recall("citation parser ignore", { topK: 5 });
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    if (hit.source !== "answer") throw new Error("type narrowing");
    expect(hit.payload.citationCount).toBe(0);
    expect(hit.payload.result).toEqual({
      ok: false,
      reason: "synthesis_failed",
    });
  });

  it("flows end-to-end through AnswerProviderImpl + searchAnswers", async () => {
    const recallSeam: AnswerRecallSeam = {
      async recall() {
        return {
          ok: true,
          hits: [...HITS],
        };
      },
    };
    const synthesizer: Synthesizer = async () =>
      "Recall ranks by min-max normalization [knowledge:k1].";
    const provider = new AnswerProviderImpl({
      recall: recallSeam,
      synthesizer,
      history: store,
    });
    const result = await provider.answer(
      "How does the recall seam rank cross-store hits?",
    );
    expect(result.ok).toBe(true);

    const contributor = createAnswerRecallContributor(store);
    const hits = await contributor.recall("recall rank cross-store", { topK: 5 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const [top] = hits;
    if (top.source !== "answer") throw new Error("type narrowing");
    expect(top.payload.query).toBe(
      "How does the recall seam rank cross-store hits?",
    );
  });
});
