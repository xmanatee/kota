import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RecallHit, RecallResult } from "./client.js";
import {
  describeRecallHit,
  formatRecallScore,
  renderRecallHitsPlain,
} from "./render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../clients/conformance/recall-render-fixture.json",
);

type RecallRenderFixture = {
  populated: {
    result: Extract<RecallResult, { ok: true }>;
    descriptions: Record<string, string>;
    scores: Record<string, string>;
    plain: string;
  };
  empty: {
    result: Extract<RecallResult, { ok: true }>;
    plain: string;
  };
  semanticUnavailable: {
    result: Extract<RecallResult, { ok: false }>;
  };
};

function loadFixture(): RecallRenderFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as RecallRenderFixture;
}

function hitKey(hit: RecallHit): string {
  return `${hit.source}:${hit.id}`;
}

describe("recall render contract", () => {
  const fixture = loadFixture();

  it("renders every recall source arm from the shared golden fixture", () => {
    expect(fixture.populated.result.hits.map((hit) => hit.source)).toEqual([
      "knowledge",
      "memory",
      "history",
      "tasks",
      "answer",
      "answer",
    ]);
    expect(renderRecallHitsPlain(fixture.populated.result.hits)).toBe(
      fixture.populated.plain,
    );
  });

  it("pins per-source descriptions and score precision through the fixture", () => {
    for (const hit of fixture.populated.result.hits) {
      expect(describeRecallHit(hit)).toBe(
        fixture.populated.descriptions[hitKey(hit)],
      );
      expect(formatRecallScore(hit.score)).toBe(
        fixture.populated.scores[hitKey(hit)],
      );
    }
  });

  it("covers empty hits and semantic_unavailable envelope arms", () => {
    expect(renderRecallHitsPlain(fixture.empty.result.hits)).toBe(
      fixture.empty.plain,
    );
    expect(fixture.semanticUnavailable.result).toEqual({
      ok: false,
      reason: "semantic_unavailable",
    });
  });
});
