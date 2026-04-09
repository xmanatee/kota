import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	linuxClick,
	linuxCursorPosition,
	linuxDoubleClick,
	linuxKey,
	linuxScroll,
	linuxType,
	resetLinuxState,
} from "./computer-use-actions-linux.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));
const mockExec = vi.mocked(execFileSync);

describe("computer-use-actions-linux", () => {
	beforeEach(() => {
		resetLinuxState();
		mockExec.mockReset();
		// Default: xdotool present
		mockExec.mockReturnValue("" as never);
	});

	it("linuxClick invokes xdotool and returns label", () => {
		expect(linuxClick(10, 20)).toBe("Clicked at (10, 20)");
		expect(mockExec).toHaveBeenCalledWith("xdotool", expect.arrayContaining(["mousemove"]), expect.any(Object));
	});

	it("linuxDoubleClick returns correct label", () => {
		expect(linuxDoubleClick(3, 4)).toBe("Double-clicked at (3, 4)");
	});

	it("linuxType returns typed text label", () => {
		expect(linuxType("hello")).toBe("Typed: hello");
		expect(mockExec).toHaveBeenCalledWith("xdotool", ["type", "--", "hello"], expect.any(Object));
	});

	it("linuxKey presses enter", () => {
		expect(linuxKey("enter")).toBe("Pressed: enter");
		expect(mockExec).toHaveBeenCalledWith("xdotool", ["key", "Return"], expect.any(Object));
	});

	it("linuxScroll scrolls up", () => {
		expect(linuxScroll("up", 3)).toBe("Scrolled up 3 steps");
		expect(mockExec).toHaveBeenCalledWith("xdotool", ["click", "--repeat", "3", "--delay", "50", "4"], expect.any(Object));
	});

	it("linuxCursorPosition parses xdotool output", () => {
		mockExec.mockReturnValueOnce("" as never); // which xdotool
		mockExec.mockReturnValueOnce("x:100 y:200 screen:0 window:12345" as never);
		resetLinuxState();
		expect(linuxCursorPosition()).toBe("Cursor position: (100, 200)");
	});

	it("linuxClick throws when xdotool is absent", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "which") throw new Error("not found");
			return "" as never;
		});
		resetLinuxState();
		expect(() => linuxClick(0, 0)).toThrow("xdotool");
	});

	it("resetLinuxState clears cached detection", () => {
		expect(() => resetLinuxState()).not.toThrow();
	});
});
