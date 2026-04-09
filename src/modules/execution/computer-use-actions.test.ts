import { describe, expect, it, vi } from "vitest";
import { needCoords, resetComputerUseState } from "./computer-use-actions.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

describe("computer-use-actions", () => {
	it("resetComputerUseState resets cached tool detection", () => {
		expect(() => resetComputerUseState()).not.toThrow();
	});

	it("needCoords returns rounded coordinates", () => {
		expect(needCoords(1.7, 2.3)).toEqual([2, 2]);
	});

	it("needCoords throws when coordinates are missing", () => {
		expect(() => needCoords(undefined, undefined)).toThrow("coordinates are required");
	});
});
