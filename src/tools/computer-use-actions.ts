import { execFileSync } from "node:child_process";

const EXEC_OPTS = { timeout: 5000, stdio: "pipe" as const };

// ─── Key mappings ────────────────────────────────────────────────────

const MAC_KEY_CODES: Record<string, number> = {
	return: 36, enter: 36, tab: 48, space: 49,
	delete: 51, backspace: 51, escape: 53, esc: 53,
	up: 126, down: 125, left: 123, right: 124,
	home: 115, end: 119, pageup: 116, pagedown: 121,
	f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
	f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

const MAC_MODIFIERS: Record<string, string> = {
	cmd: "command down", command: "command down",
	ctrl: "control down", control: "control down",
	alt: "option down", option: "option down",
	shift: "shift down",
};

const LINUX_KEYS: Record<string, string> = {
	return: "Return", enter: "Return", tab: "Tab", space: "space",
	delete: "BackSpace", backspace: "BackSpace",
	escape: "Escape", esc: "Escape",
	up: "Up", down: "Down", left: "Left", right: "Right",
	home: "Home", end: "End", pageup: "Page_Up", pagedown: "Page_Down",
	f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
	f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",
	cmd: "super", command: "super",
	ctrl: "ctrl", control: "ctrl",
	alt: "alt", option: "alt",
	shift: "shift",
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseCombo(raw: string): { modifiers: string[]; key: string } {
	const parts = raw.toLowerCase().split("+").map((s) => s.trim());
	const key = parts.pop()!;
	return { modifiers: parts, key };
}

let _hasCliclick: boolean | null = null;
function hasCliclick(): boolean {
	if (_hasCliclick === null) {
		try {
			execFileSync("which", ["cliclick"], { timeout: 2000, stdio: "pipe" });
			_hasCliclick = true;
		} catch {
			_hasCliclick = false;
		}
	}
	return _hasCliclick;
}

let _hasXdotool: boolean | null = null;
function hasXdotool(): boolean {
	if (_hasXdotool === null) {
		try {
			execFileSync("which", ["xdotool"], { timeout: 2000, stdio: "pipe" });
			_hasXdotool = true;
		} catch {
			_hasXdotool = false;
		}
	}
	return _hasXdotool;
}

/** Reset cached tool detection (for tests). */
export function resetComputerUseState(): void {
	_hasCliclick = null;
	_hasXdotool = null;
}

export function needCoords(x: unknown, y: unknown): [number, number] {
	if (typeof x !== "number" || typeof y !== "number") {
		throw new Error("x and y coordinates are required for this action");
	}
	return [Math.round(x), Math.round(y)];
}

function runOsascript(script: string): string {
	return execFileSync("osascript", ["-e", script], {
		...EXEC_OPTS,
		encoding: "utf-8",
	}).trim();
}

function asString(text: string): string {
	if (!text.includes('"')) return `"${text}"`;
	const parts = text.split('"');
	return parts.map((p) => `"${p}"`).join(" & (character id 34) & ");
}

function truncText(text: string, max = 50): string {
	return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ─── macOS implementations ──────────────────────────────────────────

export function macClick(x: number, y: number): string {
	if (hasCliclick()) {
		execFileSync("cliclick", [`c:${x},${y}`], EXEC_OPTS);
	} else {
		runOsascript(
			`tell application "System Events" to click at {${x}, ${y}}`,
		);
	}
	return `Clicked at (${x}, ${y})`;
}

export function macDoubleClick(x: number, y: number): string {
	if (hasCliclick()) {
		execFileSync("cliclick", [`dc:${x},${y}`], EXEC_OPTS);
	} else {
		runOsascript(
			`tell application "System Events" to click at {${x}, ${y}}`,
		);
		runOsascript(
			`tell application "System Events" to click at {${x}, ${y}}`,
		);
	}
	return `Double-clicked at (${x}, ${y})`;
}

export function macRightClick(x: number, y: number): string {
	if (!hasCliclick()) {
		throw new Error(
			"Right-click requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync("cliclick", [`rc:${x},${y}`], EXEC_OPTS);
	return `Right-clicked at (${x}, ${y})`;
}

export function macMove(x: number, y: number): string {
	if (!hasCliclick()) {
		throw new Error(
			"Mouse move requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync("cliclick", [`m:${x},${y}`], EXEC_OPTS);
	return `Moved cursor to (${x}, ${y})`;
}

export function macDrag(sx: number, sy: number, ex: number, ey: number): string {
	if (!hasCliclick()) {
		throw new Error(
			"Drag requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync("cliclick", [`dd:${sx},${sy}`, `du:${ex},${ey}`], EXEC_OPTS);
	return `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})`;
}

export function macType(text: string): string {
	if (hasCliclick()) {
		execFileSync("cliclick", [`t:${text}`], EXEC_OPTS);
	} else {
		runOsascript(
			`tell application "System Events" to keystroke ${asString(text)}`,
		);
	}
	return `Typed: ${truncText(text)}`;
}

export function macKey(combo: string): string {
	const { modifiers, key } = parseCombo(combo);
	const code = MAC_KEY_CODES[key];
	const modStr = modifiers.map((m) => MAC_MODIFIERS[m]).filter(Boolean);
	if (modifiers.length > 0 && modStr.length !== modifiers.length) {
		throw new Error(
			`Unknown modifier in: ${combo}. Use cmd, ctrl, alt, shift.`,
		);
	}
	const using = modStr.length > 0 ? ` using {${modStr.join(", ")}}` : "";
	if (code !== undefined) {
		runOsascript(
			`tell application "System Events" to key code ${code}${using}`,
		);
	} else if (key.length === 1) {
		runOsascript(
			`tell application "System Events" to keystroke ${asString(key)}${using}`,
		);
	} else {
		throw new Error(
			`Unknown key: ${key}. Use enter, tab, escape, f1-f12, or single characters.`,
		);
	}
	return `Pressed: ${combo}`;
}

export function macScroll(direction: string, amount: number): string {
	const code = direction === "up" ? 116 : 121;
	const lines = Array(amount).fill(`key code ${code}`).join("\n");
	runOsascript(`tell application "System Events"\n${lines}\nend tell`);
	return `Scrolled ${direction} ${amount} page(s)`;
}

export function macCursorPosition(): string {
	if (!hasCliclick()) {
		throw new Error(
			"Cursor position requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	const out = execFileSync("cliclick", ["p"], {
		...EXEC_OPTS,
		encoding: "utf-8",
	}).trim();
	return `Cursor position: ${out}`;
}

// ─── Linux implementations ──────────────────────────────────────────

function requireXdotool(): void {
	if (!hasXdotool()) {
		throw new Error(
			"xdotool required on Linux. Install: sudo apt install xdotool",
		);
	}
}

function xdotool(...args: string[]): string {
	requireXdotool();
	return execFileSync("xdotool", args, {
		...EXEC_OPTS,
		encoding: "utf-8",
	}).trim();
}

export function linuxClick(x: number, y: number): string {
	xdotool("mousemove", "--sync", String(x), String(y), "click", "1");
	return `Clicked at (${x}, ${y})`;
}

export function linuxDoubleClick(x: number, y: number): string {
	xdotool("mousemove", "--sync", String(x), String(y), "click", "--repeat", "2", "--delay", "100", "1");
	return `Double-clicked at (${x}, ${y})`;
}

export function linuxRightClick(x: number, y: number): string {
	xdotool("mousemove", "--sync", String(x), String(y), "click", "3");
	return `Right-clicked at (${x}, ${y})`;
}

export function linuxMove(x: number, y: number): string {
	xdotool("mousemove", "--sync", String(x), String(y));
	return `Moved cursor to (${x}, ${y})`;
}

export function linuxDrag(sx: number, sy: number, ex: number, ey: number): string {
	xdotool(
		"mousemove", "--sync", String(sx), String(sy),
		"mousedown", "1",
		"mousemove", "--sync", String(ex), String(ey),
		"mouseup", "1",
	);
	return `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})`;
}

export function linuxType(text: string): string {
	xdotool("type", "--", text);
	return `Typed: ${truncText(text)}`;
}

export function linuxKey(combo: string): string {
	const { modifiers, key } = parseCombo(combo);
	const parts = [...modifiers, key].map((k) => LINUX_KEYS[k] || k);
	xdotool("key", parts.join("+"));
	return `Pressed: ${combo}`;
}

export function linuxScroll(direction: string, amount: number): string {
	const button = direction === "up" ? "4" : "5";
	xdotool("click", "--repeat", String(amount), "--delay", "50", button);
	return `Scrolled ${direction} ${amount} steps`;
}

export function linuxCursorPosition(): string {
	const out = xdotool("getmouselocation");
	const match = out.match(/x:(\d+)\s+y:(\d+)/);
	return match ? `Cursor position: (${match[1]}, ${match[2]})` : `Cursor position: ${out}`;
}
