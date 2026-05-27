import { execFileSync } from "node:child_process";
import { accessSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const TRUSTED_CLICLICK = "/opt/homebrew/bin/cliclick";
const TRUSTED_OSASCRIPT = "/usr/bin/osascript";

function setExecutablePaths(paths: readonly string[]): void {
	const executablePaths = new Set(paths);
	mockAccess.mockImplementation((path) => {
		if (executablePaths.has(String(path))) return;
		throw new Error(`not executable: ${String(path)}`);
	});
	mockRealpath.mockImplementation((path) => String(path) as never);
}

describe("computer-use-actions-mac", () => {
	beforeEach(() => {
		resetMacState();
		mockExec.mockReset();
		mockAccess.mockReset();
		mockRealpath.mockReset();
		vi.stubEnv("PATH", `/opt/homebrew/bin${delimiter}/usr/bin`);
		setExecutablePaths([TRUSTED_CLICLICK, TRUSTED_OSASCRIPT]);
		mockExec.mockReturnValue("" as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("macClick uses osascript when cliclick is absent", () => {
		setExecutablePaths([TRUSTED_OSASCRIPT]);
		resetMacState();
		const result = macClick(10, 20);
		expect(result).toBe("Clicked at (10, 20)");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_OSASCRIPT, expect.any(Array), expect.any(Object));
	});

	it("macClick uses cliclick when available", () => {
		mockExec.mockReturnValue("" as never);
		resetMacState();
		const result = macClick(5, 15);
		expect(result).toBe("Clicked at (5, 15)");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_CLICLICK, ["c:5,15"], expect.any(Object));
	});

	it("macDoubleClick returns correct label", () => {
		setExecutablePaths([TRUSTED_OSASCRIPT]);
		resetMacState();
		expect(macDoubleClick(3, 4)).toBe("Double-clicked at (3, 4)");
	});

	it("macType returns typed text label", () => {
		mockExec.mockReturnValue("" as never);
		resetMacState();
		expect(macType("hello")).toBe("Typed: hello");
	});

	it("macKey presses enter via osascript", () => {
		expect(macKey("enter")).toBe("Pressed: enter");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_OSASCRIPT, expect.any(Array), expect.any(Object));
	});

	it("macScroll returns scroll label", () => {
		expect(macScroll("down", 2)).toBe("Scrolled down 2 page(s)");
		expect(mockExec).toHaveBeenCalledWith(TRUSTED_OSASCRIPT, expect.any(Array), expect.any(Object));
	});

	it("macCursorPosition throws when cliclick is absent", () => {
		setExecutablePaths([TRUSTED_OSASCRIPT]);
		resetMacState();
		expect(() => macCursorPosition()).toThrow("cliclick");
	});

	it("rejects PATH-precedence cliclick spoofing before fallback", () => {
		const projectBin = `${process.cwd()}/bin`;
		const spoofedCliclick = `${projectBin}/cliclick`;
		vi.stubEnv("PATH", `${projectBin}${delimiter}/opt/homebrew/bin${delimiter}/usr/bin`);
		setExecutablePaths([spoofedCliclick, TRUSTED_CLICLICK, TRUSTED_OSASCRIPT]);
		resetMacState();

		expect(() => macClick(0, 0)).toThrow(
			`cliclick resolved to untrusted path: ${spoofedCliclick}`,
		);
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("rejects PATH-precedence osascript spoofing before executing", () => {
		const projectBin = `${process.cwd()}/bin`;
		const spoofedOsascript = `${projectBin}/osascript`;
		vi.stubEnv("PATH", `${projectBin}${delimiter}/usr/bin`);
		setExecutablePaths([spoofedOsascript, TRUSTED_OSASCRIPT]);
		resetMacState();

		expect(() => macKey("enter")).toThrow(
			`osascript resolved to untrusted path: ${spoofedOsascript}`,
		);
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("resetMacState clears cached detection", () => {
		expect(() => resetMacState()).not.toThrow();
	});
});
