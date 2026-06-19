import type { RecallHit, RecallResult } from "@/api/types";
import { describe, expect, it } from "vitest";
import fixtureJson from "../../../conformance/recall-render-fixture.json";
import { describeRecallHit, formatRecallScore } from "./recall-render";

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

const fixture = fixtureJson as RecallRenderFixture;

function hitKey(hit: RecallHit): string {
  return `${hit.source}:${hit.id}`;
}

describe("web recall render contract", () => {
  it("describes every source arm from the shared golden fixture", () => {
    for (const hit of fixture.populated.result.hits) {
      expect(describeRecallHit(hit)).toBe(
        fixture.populated.descriptions[hitKey(hit)],
      );
      expect(formatRecallScore(hit.score)).toBe(
        fixture.populated.scores[hitKey(hit)],
      );
    }
  });

  it("covers empty hits and semantic_unavailable fixture arms", () => {
    expect(fixture.empty.result.hits).toEqual([]);
    expect(fixture.semanticUnavailable.result).toEqual({
      ok: false,
      reason: "semantic_unavailable",
    });
  });
});
