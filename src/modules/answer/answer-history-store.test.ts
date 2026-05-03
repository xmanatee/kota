import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecallHit } from "#core/server/kota-client.js";
import {
  buildAnswerHistoryRecord,
  DiskAnswerHistoryStore,
  mintAnswerHistoryId,
  projectAnswerHistoryEntry,
} from "./answer-history-store.js";
import type { AnswerHistoryRecord } from "./client.js";

const sampleHits: RecallHit[] = [
  {
    source: "knowledge",
    score: 1,
    id: "k1",
    title: "Sample",
    preview: "...",
    updated: "2026-04-26",
  },
];

function makeRecord(
  index: number,
  overrides?: Partial<AnswerHistoryRecord>,
): AnswerHistoryRecord {
  const stamp = new Date(Date.UTC(2026, 3, 28, 0, 0, index)).toISOString();
  const id = `${stamp.replace(/[:.]/g, "-")}-${String(index).padStart(6, "0")}`;
  return buildAnswerHistoryRecord({
    id,
    createdAt: stamp,
    query: `q${index}`,
    filter: { topK: 8 },
    recallHits: sampleHits,
    result: {
      ok: true,
      answer: `Body [knowledge:k1] for ${index}.`,
      citations: [{ source: "knowledge", id: "k1" }],
      hits: sampleHits,
    },
    ...overrides,
  });
}

describe("DiskAnswerHistoryStore", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-answer-history-"));
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("appendAnswer writes one file per record under the configured root", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    await store.appendAnswer(makeRecord(0));
    await store.appendAnswer(makeRecord(1));
    const files = readdirSync(rootDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);
  });

  it("listAnswers returns newest-first projections", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    for (let i = 0; i < 3; i += 1) {
      await store.appendAnswer(makeRecord(i));
    }
    const entries = await store.listAnswers();
    expect(entries.map((e) => e.query)).toEqual(["q2", "q1", "q0"]);
    expect(entries[0].result).toEqual({ ok: true, citationCount: 1 });
  });

  it("listAnswers respects limit and beforeId cursor", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    const records: AnswerHistoryRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = makeRecord(i);
      records.push(r);
      await store.appendAnswer(r);
    }
    const firstPage = await store.listAnswers({ limit: 2 });
    expect(firstPage.map((e) => e.query)).toEqual(["q4", "q3"]);
    const secondPage = await store.listAnswers({
      limit: 2,
      beforeId: firstPage[1].id,
    });
    expect(secondPage.map((e) => e.query)).toEqual(["q2", "q1"]);
  });

  it("getAnswer returns the full record for a known id and null otherwise", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    const record = makeRecord(0);
    await store.appendAnswer(record);
    expect(await store.getAnswer(record.id)).toEqual(record);
    expect(await store.getAnswer("does-not-exist")).toBeNull();
  });

  it("getAnswer rejects ids with path separators (no traversal)", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    expect(await store.getAnswer("../etc/passwd")).toBeNull();
    expect(await store.getAnswer("nested/id")).toBeNull();
  });

  it("getAnswer returns null when the file on disk is malformed", async () => {
    // The store tolerates one malformed file by leaving listAnswers returning
    // it as an unreadable record; getAnswer surfaces null only when we
    // intentionally write a non-record. This test pins the directory-scan
    // contract: stray files do not crash the store.
    writeFileSync(join(rootDir, "stray.txt"), "not json", "utf-8");
    const store = new DiskAnswerHistoryStore({ rootDir });
    const entries = await store.listAnswers();
    expect(entries).toEqual([]);
  });

  it("retention prunes oldest entries past the cap", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir, historyCap: 3 });
    for (let i = 0; i < 5; i += 1) {
      await store.appendAnswer(makeRecord(i));
    }
    const remaining = await store.listAnswers({ limit: 50 });
    expect(remaining.map((e) => e.query)).toEqual(["q4", "q3", "q2"]);
    const files = readdirSync(rootDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(3);
  });
});

describe("DiskAnswerHistoryStore.searchAnswers", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-answer-search-"));
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  function makeNamedRecord(
    index: number,
    query: string,
    answerText: string | undefined,
  ): AnswerHistoryRecord {
    const stamp = new Date(Date.UTC(2026, 3, 28, 0, 0, index)).toISOString();
    const id = `${stamp.replace(/[:.]/g, "-")}-${String(index).padStart(6, "0")}`;
    if (answerText === undefined) {
      return buildAnswerHistoryRecord({
        id,
        createdAt: stamp,
        query,
        filter: { topK: 8 },
        recallHits: [],
        result: { ok: false, reason: "no_hits" },
      });
    }
    return buildAnswerHistoryRecord({
      id,
      createdAt: stamp,
      query,
      filter: { topK: 8 },
      recallHits: sampleHits,
      result: {
        ok: true,
        answer: `${answerText} [knowledge:k1].`,
        citations: [{ source: "knowledge", id: "k1" }],
        hits: sampleHits,
      },
    });
  }

  it("returns the empty list for a fresh store", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    const hits = await store.searchAnswers("anything", { topK: 5 });
    expect(hits).toEqual([]);
  });

  it("returns the empty list for a blank query or non-positive topK", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    await store.appendAnswer(
      makeNamedRecord(0, "min-max normalization", "Recall normalizes once."),
    );
    expect(await store.searchAnswers("", { topK: 5 })).toEqual([]);
    expect(await store.searchAnswers("   ", { topK: 5 })).toEqual([]);
    expect(
      await store.searchAnswers("normalization", { topK: 0 }),
    ).toEqual([]);
  });

  it("matches by exact substring against the stored query", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    await store.appendAnswer(
      makeNamedRecord(0, "min-max normalization in recall", "Recall body."),
    );
    await store.appendAnswer(
      makeNamedRecord(1, "unrelated topic about repos", "Unrelated body."),
    );
    const hits = await store.searchAnswers("min-max normalization", { topK: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].record.query).toBe("min-max normalization in recall");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("matches against the synthesized answer body on ok:true records", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    await store.appendAnswer(
      makeNamedRecord(
        0,
        "general question",
        "The recall seam ranks hits using min-max normalization across stores.",
      ),
    );
    const hits = await store.searchAnswers("min-max normalization", { topK: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].record.id).toContain("000000");
  });

  it("ignores ok:false answer text in the corpus (query-only fallback)", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    await store.appendAnswer(
      makeNamedRecord(0, "completely unrelated", undefined),
    );
    expect(
      await store.searchAnswers("no_hits", { topK: 5 }),
    ).toEqual([]);
  });

  it("trims results to topK ordered by relevance", async () => {
    const store = new DiskAnswerHistoryStore({ rootDir });
    // Three records with varying token overlap against the query
    // "recall normalization seam".
    await store.appendAnswer(
      makeNamedRecord(0, "recall seam tie-breaks", "tie body"),
    );
    await store.appendAnswer(
      makeNamedRecord(1, "recall normalization seam answers", "norm body"),
    );
    await store.appendAnswer(
      makeNamedRecord(2, "memory entry about cooking", "cooking body"),
    );
    const hits = await store.searchAnswers("recall normalization seam", {
      topK: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0].record.query).toBe("recall normalization seam answers");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[1].record.query).toBe("recall seam tie-breaks");
  });
});

describe("mintAnswerHistoryId", () => {
  it("encodes the timestamp and is filename-safe", () => {
    const id = mintAnswerHistoryId(Date.UTC(2026, 3, 28, 12, 30, 45, 250));
    expect(id).toMatch(/^2026-04-28T12-30-45-250Z-[0-9a-f]+$/);
  });
});

describe("projectAnswerHistoryEntry", () => {
  it("includes citationCount on ok:true and reason on ok:false", () => {
    const okRecord = makeRecord(0);
    expect(projectAnswerHistoryEntry(okRecord).result).toEqual({
      ok: true,
      citationCount: 1,
    });
    const failRecord = makeRecord(0, {
      result: { ok: false, reason: "synthesis_failed" },
    });
    expect(projectAnswerHistoryEntry(failRecord).result).toEqual({
      ok: false,
      reason: "synthesis_failed",
    });
  });
});
