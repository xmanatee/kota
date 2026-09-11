import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./cosine.js";

describe("cosineSimilarity", () => {
  it.each([
    [[1, 2, 3], [1, 2, 3], 1],
    [[1, 0, 0], [0, 1, 0], 0],
    [[1, 1], [-1, -1], -1],
    [[1, 2, 3], [2, 4, 6], 1],
    [[0, 0, 0], [1, 2, 3], 0],
  ] as const)("scores %j against %j as %s", (a, b, expected) => {
    expect(cosineSimilarity([...a], [...b])).toBeCloseTo(expected);
  });

  it("rejects incompatible dimensions", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });
});
