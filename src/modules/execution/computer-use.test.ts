import { accessSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetComputerUseState, runComputerUse } from "./computer-use.js";
import {
	createScreenshotCoordinateMap,
	rememberLastActionableScreenshot,
} from "./gui-coordinate-scaling.js";

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

import { execFileSync } from "node:child_process";

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const mockAccess = vi.mocked(accessSync);
const mockRealpath = vi.mocked(realpathSync);
const TRUSTED_CLICLICK = "/opt/homebrew/bin/cliclick";
const TRUSTED_OSASCRIPT = "/usr/bin/osascript";
const TRUSTED_XDOTOOL = "/usr/bin/xdotool";

function setExecutablePaths(paths: readonly string[]): void {
	const executablePaths = new Set(paths);
	mockAccess.mockImplementation((path) => {
		if (executablePaths.has(String(path))) return;
		throw new Error(`not executable: ${String(path)}`);
	});
	mockRealpath.mockImplementation((path) => String(path) as never);
}

function native<T extends object>(input: T): T & { coordinate_space: "native" } {
	return { ...input, coordinate_space: "native" };
}

describe("runComputerUse", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		resetComputerUseState();
		mockAccess.mockReset();
		mockRealpath.mockReset();
		vi.stubEnv(
			"PATH",
			`/opt/homebrew/bin${delimiter}/usr/bin`,
		);
		setExecutablePaths([
			TRUSTED_CLICLICK,
			TRUSTED_OSASCRIPT,
			TRUSTED_XDOTOOL,
		]);
		mockExec.mockReturnValue("");
	});

	afterEach(() => {
		setPlatform(originalPlatform);
		vi.unstubAllEnvs();
	});

	// ─── Platform support ────────────────────────────────────────────

	it("returns error on unsupported platform", async () => {
		setPlatform("win32");
		const r = await runComputerUse({ action: "click", x: 100, y: 200 });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("not supported");
		expect(r.content).toContain("win32");
	});

	it("returns error for unknown action", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "teleport" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("Unknown action");
	});

	// ─── Coordinate validation ───────────────────────────────────────

	it("requires coordinates for click", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "click" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("coordinates are required");
	});

	it("requires explicit coordinate space for coordinate actions", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "click", x: 100, y: 200 });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("coordinate_space is required");
	});

	it("requires text for type action", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "type" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("text is required");
	});

	it("requires key_combo for key action", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "key" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("key_combo is required");
	});

	it("requires start coords for drag", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "drag", x: 200, y: 300 });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("start_x and start_y required");
	});

	// ─── macOS: click with cliclick ──────────────────────────────────

	it("clicks via cliclick when available on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockReturnValue("");

		const r = await runComputerUse(native({ action: "click", x: 300, y: 400 }));
		expect(r.content).toBe("Clicked at (300, 400)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["c:300,400"],
			expect.any(Object),
		);
	});

	it("falls back to osascript click when cliclick missing", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();

		const r = await runComputerUse(native({ action: "click", x: 300, y: 400 }));
		expect(r.content).toBe("Clicked at (300, 400)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("click at {300, 400}")],
			expect.any(Object),
		);
	});

	it("double clicks via cliclick", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "double_click",
			x: 150,
			y: 250,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Double-clicked at (150, 250)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["dc:150,250"],
			expect.any(Object),
		);
	});

	it("right clicks via cliclick", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "right_click",
			x: 100,
			y: 200,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Right-clicked at (100, 200)");
	});

	it("errors on right_click without cliclick", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();

		const r = await runComputerUse({
			action: "right_click",
			x: 100,
			y: 200,
			coordinate_space: "native",
		});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("cliclick");
	});

	// ─── macOS: move ─────────────────────────────────────────────────

	it("moves cursor via cliclick", async () => {
		setPlatform("darwin");
		const r = await runComputerUse(native({ action: "move", x: 500, y: 600 }));
		expect(r.content).toBe("Moved cursor to (500, 600)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["m:500,600"],
			expect.any(Object),
		);
	});

	it("errors on move without cliclick", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();

		const r = await runComputerUse(native({ action: "move", x: 500, y: 600 }));
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("cliclick");
	});

	// ─── macOS: drag ─────────────────────────────────────────────────

	it("drags via cliclick", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "drag",
			start_x: 100,
			start_y: 100,
			x: 200,
			y: 200,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Dragged from (100, 100) to (200, 200)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["dd:100,100", "du:200,200"],
			expect.any(Object),
		);
	});

	// ─── macOS: type ─────────────────────────────────────────────────

	it("types text via cliclick when available", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "type", text: "hello" });
		expect(r.content).toBe("Typed: hello");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["t:hello"],
			expect.any(Object),
		);
	});

	it("types via osascript when cliclick missing", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();

		const r = await runComputerUse({ action: "type", text: "world" });
		expect(r.content).toBe("Typed: world");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining('keystroke "world"')],
			expect.any(Object),
		);
	});

	it("handles quotes in type via osascript", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();

		const r = await runComputerUse({ action: "type", text: 'say "hi"' });
		expect(r.content).toBe('Typed: say "hi"');
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("character id 34")],
			expect.any(Object),
		);
	});

	it("truncates long text in output", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "type",
			text: "a".repeat(100),
		});
		expect(r.content).toContain("...");
	});

	// ─── macOS: key ──────────────────────────────────────────────────

	it("presses special key via osascript", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "key", key_combo: "enter" });
		expect(r.content).toBe("Pressed: enter");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("key code 36")],
			expect.any(Object),
		);
	});

	it("presses key combo with modifiers", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "key", key_combo: "cmd+c" });
		expect(r.content).toBe("Pressed: cmd+c");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("command down")],
			expect.any(Object),
		);
	});

	it("presses multi-modifier combo", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "key",
			key_combo: "cmd+shift+z",
		});
		expect(r.content).toBe("Pressed: cmd+shift+z");
		const script = mockExec.mock.calls.find(
			(c: unknown[]) => c[0] === TRUSTED_OSASCRIPT,
		)?.[1][1] as string;
		expect(script).toContain("command down");
		expect(script).toContain("shift down");
	});

	it("errors on unknown modifier", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "key",
			key_combo: "mega+c",
		});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("Unknown modifier");
	});

	it("errors on unknown key name", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "key",
			key_combo: "superkey",
		});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("Unknown key");
	});

	it("presses single character key", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "key", key_combo: "a" });
		expect(r.content).toBe("Pressed: a");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining('keystroke "a"')],
			expect.any(Object),
		);
	});

	// ─── macOS: scroll ───────────────────────────────────────────────

	it("scrolls down via page down key codes", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "scroll",
			direction: "down",
			amount: 2,
		});
		expect(r.content).toContain("Scrolled down 2");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("key code 121")],
			expect.any(Object),
		);
	});

	it("scrolls up via page up key codes", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "scroll",
			direction: "up",
			amount: 1,
		});
		expect(r.content).toContain("Scrolled up 1");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_OSASCRIPT,
			["-e", expect.stringContaining("key code 116")],
			expect.any(Object),
		);
	});

	it("caps scroll amount at 20", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "scroll",
			direction: "down",
			amount: 100,
		});
		expect(r.content).toContain("20");
	});

	it("defaults scroll to 3 steps down", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({ action: "scroll" });
		expect(r.content).toContain("down");
		expect(r.content).toContain("3");
	});

	// ─── macOS: cursor_position ──────────────────────────────────────

	it("gets cursor position via cliclick", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === TRUSTED_CLICLICK) return "300,400\n";
			return "";
		});

		const r = await runComputerUse({ action: "cursor_position" });
		expect(r.content).toContain("300,400");
	});

	// ─── Linux: click ────────────────────────────────────────────────

	it("clicks via xdotool on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse(native({ action: "click", x: 300, y: 400 }));
		expect(r.content).toBe("Clicked at (300, 400)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			["mousemove", "--sync", "300", "400", "click", "1"],
			expect.any(Object),
		);
	});

	it("double clicks on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({
			action: "double_click",
			x: 100,
			y: 200,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Double-clicked at (100, 200)");
	});

	it("right clicks on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({
			action: "right_click",
			x: 100,
			y: 200,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Right-clicked at (100, 200)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			expect.arrayContaining(["click", "3"]),
			expect.any(Object),
		);
	});

	// ─── Linux: move, drag ───────────────────────────────────────────

	it("moves cursor on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse(native({ action: "move", x: 500, y: 600 }));
		expect(r.content).toBe("Moved cursor to (500, 600)");
	});

	it("drags on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({
			action: "drag",
			start_x: 10,
			start_y: 20,
			x: 200,
			y: 300,
			coordinate_space: "native",
		});
		expect(r.content).toBe("Dragged from (10, 20) to (200, 300)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			expect.arrayContaining(["mousedown", "1", "mouseup", "1"]),
			expect.any(Object),
		);
	});

	// ─── Linux: type, key ────────────────────────────────────────────

	it("types text on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({ action: "type", text: "hello" });
		expect(r.content).toBe("Typed: hello");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			["type", "--", "hello"],
			expect.any(Object),
		);
	});

	it("presses key combo on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({ action: "key", key_combo: "ctrl+c" });
		expect(r.content).toBe("Pressed: ctrl+c");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			["key", "ctrl+c"],
			expect.any(Object),
		);
	});

	it("maps key names for Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({ action: "key", key_combo: "enter" });
		expect(r.content).toBe("Pressed: enter");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			["key", "Return"],
			expect.any(Object),
		);
	});

	// ─── Linux: scroll ───────────────────────────────────────────────

	it("scrolls down on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({
			action: "scroll",
			direction: "down",
			amount: 5,
		});
		expect(r.content).toBe("Scrolled down 5 steps");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			["click", "--repeat", "5", "--delay", "50", "5"],
			expect.any(Object),
		);
	});

	it("scrolls up on Linux", async () => {
		setPlatform("linux");
		const r = await runComputerUse({
			action: "scroll",
			direction: "up",
			amount: 3,
		});
		expect(r.content).toBe("Scrolled up 3 steps");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_XDOTOOL,
			expect.arrayContaining(["4"]),
			expect.any(Object),
		);
	});

	// ─── Linux: cursor_position ──────────────────────────────────────

	it("gets cursor position on Linux", async () => {
		setPlatform("linux");
		mockExec.mockReturnValue("x:300 y:400 screen:0 window:12345678");

		const r = await runComputerUse({ action: "cursor_position" });
		expect(r.content).toBe("Cursor position: (300, 400)");
	});

	// ─── Linux: missing xdotool ──────────────────────────────────────

	it("errors when xdotool missing on Linux", async () => {
		setPlatform("linux");
		setExecutablePaths([TRUSTED_CLICLICK, TRUSTED_OSASCRIPT]);
		resetComputerUseState();

		const r = await runComputerUse(native({ action: "click", x: 100, y: 200 }));
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("xdotool");
	});

	// ─── Accessibility error detection ───────────────────────────────

	it("detects accessibility permission error", async () => {
		setPlatform("darwin");
		setExecutablePaths([TRUSTED_OSASCRIPT, TRUSTED_XDOTOOL]);
		resetComputerUseState();
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === TRUSTED_OSASCRIPT) {
				throw new Error("assistive access is not enabled");
			}
			return "";
		});

		const r = await runComputerUse({ action: "type", text: "test" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("Accessibility permission");
	});

	// ─── Coordinate rounding ─────────────────────────────────────────

	it("rounds fractional coordinates", async () => {
		setPlatform("darwin");
		const r = await runComputerUse(
			native({ action: "click", x: 300.7, y: 400.3 }),
		);
		expect(r.content).toBe("Clicked at (301, 400)");
	});

	it("converts last screenshot display coordinates before clicking", async () => {
		setPlatform("darwin");
		rememberLastActionableScreenshot(
			createScreenshotCoordinateMap(
				{ width: 3000, height: 2000 },
				{ width: 1500, height: 1000 },
			),
		);

		const r = await runComputerUse({
			action: "click",
			x: 750,
			y: 250,
			coordinate_space: "last_screenshot_display",
		});

		expect(r.content).toBe("Clicked at (1500, 500)");
		expect(mockExec).toHaveBeenCalledWith(
			TRUSTED_CLICLICK,
			["c:1500,500"],
			expect.any(Object),
		);
	});

	it("rejects display coordinates without an actionable screenshot", async () => {
		setPlatform("darwin");
		const r = await runComputerUse({
			action: "click",
			x: 750,
			y: 250,
			coordinate_space: "last_screenshot_display",
		});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("requires a prior actionable screenshot");
	});
});
