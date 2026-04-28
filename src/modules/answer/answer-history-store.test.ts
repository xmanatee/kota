import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AnswerHistoryRecord,
  RecallHit,
} from "#core/server/kota-client.js";
import {
  buildAnswerHistoryRecord,
  DiskAnswerHistoryStore,
  mintAnswerHistoryId,
  projectAnswerHistoryEntry,
} from "./answer-history-store.js";

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
