import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	macClick,
	macCursorPosition,
	macDoubleClick,
	macKey,
	macScroll,
	macType,
	resetMacState,
} from "./computer-use-actions-mac.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));
const mockExec = vi.mocked(execFileSync);

describe("computer-use-actions-mac", () => {
	beforeEach(() => {
		resetMacState();
		mockExec.mockReset();
	});

	it("macClick uses osascript when cliclick is absent", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		const result = macClick(10, 20);
		expect(result).toBe("Clicked at (10, 20)");
		expect(mockExec).toHaveBeenCalledWith("osascript", expect.any(Array), expect.any(Object));
	});

	it("macClick uses cliclick when available", () => {
		mockExec.mockReturnValue("" as never);
		resetMacState();
		const result = macClick(5, 15);
		expect(result).toBe("Clicked at (5, 15)");
		expect(mockExec).toHaveBeenCalledWith("cliclick", ["c:5,15"], expect.any(Object));
	});

	it("macDoubleClick returns correct label", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		expect(macDoubleClick(3, 4)).toBe("Double-clicked at (3, 4)");
	});

	it("macType returns typed text label", () => {
		mockExec.mockReturnValue("" as never);
		resetMacState();
		expect(macType("hello")).toBe("Typed: hello");
	});

	it("macKey presses enter via osascript", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		expect(macKey("enter")).toBe("Pressed: enter");
	});

	it("macScroll returns scroll label", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		expect(macScroll("down", 2)).toBe("Scrolled down 2 page(s)");
	});

	it("macCursorPosition throws when cliclick is absent", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		expect(() => macCursorPosition()).toThrow("cliclick");
	});

	it("resetMacState clears cached detection", () => {
		expect(() => resetMacState()).not.toThrow();
	});
});
