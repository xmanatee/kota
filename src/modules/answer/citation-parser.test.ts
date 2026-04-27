import { describe, expect, it } from "vitest";
import type { RecallHit } from "#core/server/kota-client.js";
import { parseCitations, selectCitedHits } from "./citation-parser.js";

const hits: RecallHit[] = [
  {
    source: "knowledge",
    score: 1,
    id: "k1",
    title: "T",
    preview: "p",
    updated: "2026-04-26",
  },
  {
    source: "memory",
    score: 0.5,
    id: "m1",
    preview: "memo",
    created: "2026-04-25",
  },
  {
    source: "tasks",
    score: 0.4,
    id: "task-recall-seam",
    title: "Add recall",
    state: "doing",
    priority: "p2",
    updatedAt: "2026-04-27",
  },
];

describe("parseCitations", () => {
  it("extracts in-order, de-duplicated citations from inline markers", () => {
    const text =
      "Sentence one [knowledge:k1] and another claim [memory:m1]. Repeat [knowledge:k1] is dropped.";
    const parsed = parseCitations(text, hits);
    expect(parsed.citations).toEqual([
      { source: "knowledge", id: "k1" },
      { source: "memory", id: "m1" },
    ]);
    expect(parsed.unknownMarkers).toEqual([]);
  });

  it("collects unknown markers without rewriting the text", () => {
    const text = "Real [knowledge:k1] and phantom [tasks:task-fake-id].";
    const parsed = parseCitations(text, hits);
    expect(parsed.citations).toEqual([{ source: "knowledge", id: "k1" }]);
    expect(parsed.unknownMarkers).toEqual(["[tasks:task-fake-id]"]);
  });

  it("ignores tokens that do not match the strict marker shape", () => {
    const text =
      "[other:something] looks like a citation but other is not a recall source. [knowledge: k1] has whitespace and is rejected.";
    const parsed = parseCitations(text, hits);
    expect(parsed.citations).toEqual([]);
    expect(parsed.unknownMarkers).toEqual([]);
  });

  it("supports task ids that contain dashes", () => {
    const text = "See [tasks:task-recall-seam].";
    const parsed = parseCitations(text, hits);
    expect(parsed.citations).toEqual([
      { source: "tasks", id: "task-recall-seam" },
    ]);
  });

  it("returns the empty result for an empty text", () => {
    expect(parseCitations("", hits)).toEqual({
      citations: [],
      unknownMarkers: [],
    });
  });
});

describe("selectCitedHits", () => {
  it("filters hits to the citation set, preserving original order", () => {
    const cited = selectCitedHits(
      [
        { source: "tasks", id: "task-recall-seam" },
        { source: "knowledge", id: "k1" },
      ],
      hits,
    );
    expect(cited.map((h) => `${h.source}:${h.id}`)).toEqual([
      "knowledge:k1",
      "tasks:task-recall-seam",
    ]);
  });

  it("returns empty when there are no citations", () => {
    expect(selectCitedHits([], hits)).toEqual([]);
  });
});
