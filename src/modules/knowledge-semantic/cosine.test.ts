import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./cosine.js";

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
	});

	it("returns 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
	});

	it("returns -1 for opposite vectors", () => {
		expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
	});

	it("is scale-invariant", () => {
		expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
	});

	it("returns 0 when one vector is all zeros", () => {
		expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
	});

	it("throws on length mismatch", () => {
		expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
	});

	it("ranks similar pairs higher", () => {
		const query = [1, 0, 0];
		const near = [0.9, 0.1, 0.1];
		const far = [0, 0, 1];
		expect(cosineSimilarity(query, near)).toBeGreaterThan(
			cosineSimilarity(query, far),
		);
	});
});
