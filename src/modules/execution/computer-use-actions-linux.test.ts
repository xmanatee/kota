import { execFileSync } from "node:child_process";
import { accessSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		accessSync: vi.fn(),
		realpathSync: vi.fn(),
	};
});

const mockExec = vi.mocked(execFileSync);
const mockAccess = vi.mocked(accessSync);
const mockRealpath = vi.mocked(realpathSync);
const TRUSTED_XDOTOOL = "/usr/bin/xdotool";

function setExecutablePaths(paths: readonly string[]): void {
	const executablePaths = new Set(paths);
	mockAccess.mockImplementation((path) => {
		if (executablePaths.has(String(path))) return;
		throw new Error(`not executable: ${String(path)}`);
	});
	mockRealpath.mockImplementation((path) => String(path) as never);
}

describe("computer-use-actions-linux", () => {
	beforeEach(() => {
		resetLinuxState();
		mockExec.mockReset();
		mockAccess.mockReset();
		mockRealpath.mockReset();
		vi.stubEnv("PATH", "/usr/bin");
		setExecutablePaths([TRUSTED_XDOTOOL]);
		mockExec.mockReturnValue("" as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("linuxClick invokes xdotool and returns label", () => {
		expect(linuxClick(10, 20)).toBe("Clicked at (10, 20)");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_XDOTOOL, expect.arrayContaining(["mousemove"]), expect.any(Object));
	});

	it("linuxDoubleClick returns correct label", () => {
		expect(linuxDoubleClick(3, 4)).toBe("Double-clicked at (3, 4)");
	});

	it("linuxType returns typed text label", () => {
		expect(linuxType("hello")).toBe("Typed: hello");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_XDOTOOL, ["type", "--", "hello"], expect.any(Object));
	});

	it("linuxKey presses enter", () => {
		expect(linuxKey("enter")).toBe("Pressed: enter");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_XDOTOOL, ["key", "Return"], expect.any(Object));
	});

	it("linuxScroll scrolls up", () => {
		expect(linuxScroll("up", 3)).toBe("Scrolled up 3 steps");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_XDOTOOL, ["click", "--repeat", "3", "--delay", "50", "4"], expect.any(Object));
	});

	it("linuxCursorPosition parses xdotool output", () => {
		mockExec.mockReturnValueOnce("x:100 y:200 screen:0 window:12345" as never);
		expect(linuxCursorPosition()).toBe("Cursor position: (100, 200)");
	});

	it("linuxClick throws when xdotool is absent", () => {
		setExecutablePaths([]);
		resetLinuxState();
		expect(() => linuxClick(0, 0)).toThrow("xdotool");
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("rejects PATH-precedence xdotool spoofing before executing", () => {
		const projectBin = `${process.cwd()}/bin`;
		const spoofedXdotool = `${projectBin}/xdotool`;
		vi.stubEnv("PATH", `${projectBin}${delimiter}/usr/bin`);
		setExecutablePaths([spoofedXdotool, TRUSTED_XDOTOOL]);
		resetLinuxState();

		expect(() => linuxClick(0, 0)).toThrow(
			`xdotool resolved to untrusted path: ${spoofedXdotool}`,
		);
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("resetLinuxState clears cached detection", () => {
		expect(() => resetLinuxState()).not.toThrow();
	});
});
