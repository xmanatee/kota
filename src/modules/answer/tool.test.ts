import { describe, expect, it } from "vitest";
import type {
  AnswerHistoryRecord,
  RecallHit,
  RecallResult,
} from "#core/server/kota-client.js";
import type { AnswerHistorySink } from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import type { AnswerRecallSeam, Synthesizer } from "./answer-types.js";
import { answerTool, createAnswerToolRunner } from "./tool.js";

function fixedRecall(result: RecallResult): AnswerRecallSeam {
  return {
    async recall() {
      return result;
    },
  };
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
];

describe("answer tool — schema", () => {
  it("declares a JSON schema with `query` required and every recall source enumerated", () => {
    expect(answerTool.name).toBe("answer");
    expect(answerTool.input_schema.required).toEqual(["query"]);
    const props = answerTool.input_schema.properties as Record<string, unknown>;
    expect(props.query).toBeDefined();
    const sources = (props.sources as { items: { enum: string[] } }).items;
    expect(sources.enum).toEqual([
      "knowledge",
      "memory",
      "history",
      "tasks",
      "answer",
    ]);
  });
});

describe("answer tool — runner success arms", () => {
  it("renders a synthesized answer with the citation block via the shared chat renderer", async () => {
    const synthesizer: Synthesizer = async () =>
      "The recall seam ranks hits [knowledge:k1] and the task landed [tasks:task-add-recall].";
    const { sink, records } = recordingSink();
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: sink,
    });
    const runner = createAnswerToolRunner(() => provider);

    const result = await runner({ query: "How does recall work?" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("[knowledge:k1]");
    expect(result.content).toContain("Citations");
    expect(result.content).toContain("knowledge");
    expect(result.content).toContain("k1");
    expect(records).toHaveLength(1);
    expect(records[0].result.ok).toBe(true);
  });
});

describe("answer tool — runner failure arms", () => {
  it("surfaces no_hits as an error result with the operator-friendly body when recall returns empty", async () => {
    const synthesizer: Synthesizer = async () => {
      throw new Error("synthesizer should not be called when recall is empty");
    };
    const { sink } = recordingSink();
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: [] }),
      synthesizer,
      history: sink,
    });
    const runner = createAnswerToolRunner(() => provider);

    const result = await runner({ query: "anything" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("No matching sources");
  });

  it("surfaces semantic_unavailable verbatim from the recall seam", async () => {
    const synthesizer: Synthesizer = async () => {
      throw new Error("synthesizer should not be called when recall is unconfigured");
    };
    const { sink } = recordingSink();
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: false, reason: "semantic_unavailable" }),
      synthesizer,
      history: sink,
    });
    const runner = createAnswerToolRunner(() => provider);

    const result = await runner({ query: "x" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("no registered contributors");
  });

  it("rejects an invalid `topK` with a typed error before reaching the provider", async () => {
    const synthesizer: Synthesizer = async () => "ignored";
    const { sink } = recordingSink();
    const provider = new AnswerProviderImpl({
      recall: fixedRecall({ ok: true, hits: sampleHits }),
      synthesizer,
      history: sink,
    });
    const runner = createAnswerToolRunner(() => provider);

    const result = await runner({ query: "x", topK: -1 });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("`topK` must be a positive integer");
  });
});
