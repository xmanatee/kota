import { describe, expect, it, vi } from "vitest";
import type {
  RecallFilter,
  RecallHit,
  RecallResult,
} from "#core/server/kota-client.js";
import type { AnswerHistorySink } from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import type { AnswerRecallSeam, Synthesizer } from "./answer-types.js";
import type { AnswerHistoryRecord } from "./client.js";

function fixedRecall(result: RecallResult): AnswerRecallSeam {
  return {
    async recall() {
      return result;
    },
  };
}

function captureRecall(
  result: RecallResult,
): { seam: AnswerRecallSeam; calls: Array<{ query: string; filter?: RecallFilter }> } {
  const calls: Array<{ query: string; filter?: RecallFilter }> = [];
  const seam: AnswerRecallSeam = {
    async recall(query, filter) {
      calls.push({ query, ...(filter !== undefined && { filter }) });
      return result;
    },
  };
  return { seam, calls };
}

function recordingSink(): {
  sink: AnswerHistorySink;
  records: AnswerHistoryRecord[];
} {
  const records: AnswerHistoryRecord[] = [];
  return {
    records,
    sink: {
      async appendAnswer(record) {
        records.push(record);
      },
    },
  };
}

const noopSink: AnswerHistorySink = {
  async appendAnswer() {
    /* noop */
  },
};

const sampleHits: RecallHit[] = [
  {
    source: "knowledge",
    score: 1,
    id: "k1",
    title: "Cross-store recall design",
    preview: "Notes on the recall seam",
    updated: "2026-04-26",
  },
  {
    source: "tasks",
    score: 0.82,
    id: "task-add-recall",
    title: "Add cross-store recall seam",
    state: "done",
    priority: "p1",
    updatedAt: "2026-04-25",
  },
  {
    source: "memory",
    score: 0.5,
    id: "m1",
    preview: "Idea: separate retrieval from synthesis",
    created: "2026-04-20",
  },
];

describe("AnswerProviderImpl", () => {
  it("returns a typed answer envelope with parsed citations and selected hits", async () => {
    const synthesizer: Synthesizer = async () =>
      "The recall seam ranks hits across stores [knowledge:k1] and the work landed under task [tasks:task-add-recall].";
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("How does recall work?");
    if (!result.ok) {
      throw new Error(`expected ok:true, got ${result.reason}`);
    }
    expect(result.answer).toContain("[knowledge:k1]");
    expect(result.citations).toEqual([
      { source: "knowledge", id: "k1" },
      { source: "tasks", id: "task-add-recall" },
    ]);
    expect(result.hits.map((h) => `${h.source}:${h.id}`)).toEqual([
      "knowledge:k1",
      "tasks:task-add-recall",
    ]);
  });

  it("is stable: identical query against identical hits returns the same envelope", async () => {
    const synthesizer: Synthesizer = async () =>
      "Stable answer [knowledge:k1] body [memory:m1].";
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const a = await provider.answer("question");
    const b = await provider.answer("question");
    expect(a).toEqual(b);
  });

  it("forwards semantic_unavailable from recall verbatim", async () => {
    const synthesizer = vi.fn(async () => "should not be called");
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: false, reason: "semantic_unavailable" }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("anything");
    expect(result).toEqual({ ok: false, reason: "semantic_unavailable" });
    expect(synthesizer).not.toHaveBeenCalled();
  });

  it("returns no_hits when recall returns an empty list", async () => {
    const synthesizer = vi.fn(async () => "should not be called");
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: [] }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("nothing");
    expect(result).toEqual({ ok: false, reason: "no_hits" });
    expect(synthesizer).not.toHaveBeenCalled();
  });

  it("returns no_hits for a blank query without invoking the synthesizer", async () => {
    const synthesizer = vi.fn(async () => "n/a");
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("   ");
    expect(result).toEqual({ ok: false, reason: "no_hits" });
    expect(synthesizer).not.toHaveBeenCalled();
  });

  it("retries synthesis once when an unknown citation marker appears", async () => {
    const calls: Array<{ retry: boolean }> = [];
    const synthesizer: Synthesizer = async (input) => {
      calls.push({ retry: input.retry });
      if (calls.length === 1) {
        return "Initial answer cites a phantom [knowledge:phantom-id] and a real one [tasks:task-add-recall].";
      }
      return "Retry answer [knowledge:k1] also [tasks:task-add-recall].";
    };
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("query");
    if (!result.ok) {
      throw new Error(`expected ok:true after retry, got ${result.reason}`);
    }
    expect(calls).toEqual([{ retry: false }, { retry: true }]);
    expect(result.citations).toEqual([
      { source: "knowledge", id: "k1" },
      { source: "tasks", id: "task-add-recall" },
    ]);
  });

  it("surfaces synthesis_failed when the model throws on the initial call", async () => {
    const errors: unknown[] = [];
    let attempts = 0;
    const synthesizer: Synthesizer = async () => {
      attempts += 1;
      throw new Error("model unreachable");
    };
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
      onSynthesisError: (err) => errors.push(err),
    });
    const result = await provider.answer("query");
    expect(result).toEqual({ ok: false, reason: "synthesis_failed" });
    expect(attempts).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("surfaces synthesis_failed when malformed citations survive the retry", async () => {
    const errors: unknown[] = [];
    const synthesizer: Synthesizer = async () =>
      "Reply with only an unknown citation [knowledge:nope].";
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
      onSynthesisError: (err) => errors.push(err),
    });
    const result = await provider.answer("query");
    expect(result).toEqual({ ok: false, reason: "synthesis_failed" });
    expect(errors).toHaveLength(1);
  });

  it("surfaces synthesis_failed when the model emits no citation markers at all", async () => {
    const synthesizer: Synthesizer = async () =>
      "I don't know — no sources support this question.";
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("query");
    expect(result).toEqual({ ok: false, reason: "synthesis_failed" });
  });

  it("forwards the answer-default topK when the caller does not set one", async () => {
    const { seam, calls } = captureRecall({ ok: true, hits: sampleHits });
    const synthesizer: Synthesizer = async () => "Body [knowledge:k1].";
    const provider = new AnswerProviderImpl({
      recall: seam,
      synthesizer,
      history: noopSink,
    });
    await provider.answer("query");
    expect(calls).toHaveLength(1);
    expect(calls[0].filter?.topK).toBe(8);
  });

  it("forwards a caller topK override unchanged into recall", async () => {
    const { seam, calls } = captureRecall({ ok: true, hits: sampleHits });
    const synthesizer: Synthesizer = async () => "Body [knowledge:k1].";
    const provider = new AnswerProviderImpl({
      recall: seam,
      synthesizer,
      history: noopSink,
    });
    await provider.answer("query", { topK: 3, sources: ["knowledge"] });
    expect(calls[0].filter).toEqual({ topK: 3, sources: ["knowledge"] });
  });

  it("invokes the synthesizer at most twice (initial + single retry)", async () => {
    let attempts = 0;
    const synthesizer: Synthesizer = async () => {
      attempts += 1;
      return "Reply [knowledge:phantom].";
    };
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: noopSink,
    });
    const result = await provider.answer("query");
    expect(result.ok).toBe(false);
    expect(attempts).toBe(2);
  });

  describe("history persistence", () => {
    it("appends one record on the ok:true success arm with hits and citations", async () => {
      const { sink, records } = recordingSink();
      const synthesizer: Synthesizer = async () =>
        "Body [knowledge:k1] then [tasks:task-add-recall].";
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: true, hits: sampleHits }),
        synthesizer,
        history: sink,
      });
      const result = await provider.answer("How does recall work?");
      expect(result.ok).toBe(true);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.query).toBe("How does recall work?");
      expect(record.recallHits).toEqual(sampleHits);
      expect(record.result.ok).toBe(true);
      if (record.result.ok) {
        expect(record.result.citations).toEqual([
          { source: "knowledge", id: "k1" },
          { source: "tasks", id: "task-add-recall" },
        ]);
      }
      expect(record.filter.topK).toBe(8);
    });

    it("appends one record on the no_hits failure arm", async () => {
      const { sink, records } = recordingSink();
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: true, hits: [] }),
        synthesizer: async () => "n/a",
        history: sink,
      });
      const result = await provider.answer("nothing");
      expect(result).toEqual({ ok: false, reason: "no_hits" });
      expect(records).toHaveLength(1);
      expect(records[0].result).toEqual({ ok: false, reason: "no_hits" });
      expect(records[0].recallHits).toEqual([]);
    });

    it("appends one record on the semantic_unavailable failure arm", async () => {
      const { sink, records } = recordingSink();
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: false, reason: "semantic_unavailable" }),
        synthesizer: async () => "n/a",
        history: sink,
      });
      const result = await provider.answer("anything");
      expect(result).toEqual({ ok: false, reason: "semantic_unavailable" });
      expect(records).toHaveLength(1);
      expect(records[0].result).toEqual({
        ok: false,
        reason: "semantic_unavailable",
      });
    });

    it("appends one record on the synthesis_failed failure arm", async () => {
      const { sink, records } = recordingSink();
      const synthesizer: Synthesizer = async () => {
        throw new Error("boom");
      };
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: true, hits: sampleHits }),
        synthesizer,
        history: sink,
      });
      const result = await provider.answer("query");
      expect(result).toEqual({ ok: false, reason: "synthesis_failed" });
      expect(records).toHaveLength(1);
      expect(records[0].result).toEqual({
        ok: false,
        reason: "synthesis_failed",
      });
      expect(records[0].recallHits).toEqual(sampleHits);
    });

    it("preserves the original (untrimmed) query verbatim in the record", async () => {
      const { sink, records } = recordingSink();
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: true, hits: sampleHits }),
        synthesizer: async () => "Body [knowledge:k1].",
        history: sink,
      });
      await provider.answer("  spaced  ");
      expect(records).toHaveLength(1);
      expect(records[0].query).toBe("  spaced  ");
    });

    it("a failing append never alters the operator-visible response", async () => {
      const persistErrors: unknown[] = [];
      const failingSink: AnswerHistorySink = {
        async appendAnswer() {
          throw new Error("disk full");
        },
      };
      const provider = new AnswerProviderImpl({
        recall: fixedRecall({ ok: true, hits: sampleHits }),
        synthesizer: async () => "Body [knowledge:k1].",
        history: failingSink,
        onPersistError: (err) => persistErrors.push(err),
      });
      const result = await provider.answer("query");
      expect(result.ok).toBe(true);
      expect(persistErrors).toHaveLength(1);
    });
  });
});
