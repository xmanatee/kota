import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
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

function lastExecOptions(): ExecFileSyncOptions {
	const call = mockExec.mock.calls.at(-1);
	if (!call) throw new Error("expected execFileSync call");
	const options = call[2];
	if (!options || typeof options !== "object") {
		throw new Error("expected execFileSync options");
	}
	return options as ExecFileSyncOptions;
}

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

	it("runs cliclick with a minimal GUI environment instead of inherited secrets", () => {
		vi.stubEnv("__CF_USER_TEXT_ENCODING", "0x1F5:0x0:0x0");
		vi.stubEnv("KOTA_GUI_HELPER_SECRET", "should-not-leak");

		macClick(5, 15);

		const env = lastExecOptions().env;
		if (!env) throw new Error("expected GUI helper env");
		expect(env).toEqual(expect.objectContaining({
			__CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0",
		}));
		expect(env).not.toHaveProperty("KOTA_GUI_HELPER_SECRET");
		expect(env).not.toBe(process.env);
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
