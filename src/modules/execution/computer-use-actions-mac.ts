import { execFileSync } from "node:child_process";
import { guiHelperExecOptions, parseCombo, truncText } from "./computer-use-actions-shared.js";
import { resolveTrustedGuiHelper } from "./computer-use-trusted-executables.js";

// ─── Key mappings ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _cliclickPath: string | null | undefined;
let _osascriptPath: string | null | undefined;

export function resetMacState(): void {
	_cliclickPath = undefined;
	_osascriptPath = undefined;
}

function cliclickPath(): string | null {
	if (_cliclickPath === undefined) {
		_cliclickPath = resolveTrustedGuiHelper("cliclick");
	}
	return _cliclickPath;
}

function osascriptPath(): string {
	if (_osascriptPath === undefined) {
		_osascriptPath = resolveTrustedGuiHelper("osascript");
	}
	if (!_osascriptPath) {
		throw new Error("osascript required on macOS at a trusted system path");
	}
	return _osascriptPath;
}

function runOsascript(script: string): string {
	return execFileSync(osascriptPath(), ["-e", script], {
		...guiHelperExecOptions(),
		encoding: "utf-8",
	}).trim();
}

function asString(text: string): string {
	if (!text.includes('"')) return `"${text}"`;
	const parts = text.split('"');
	return parts.map((p) => `"${p}"`).join(" & (character id 34) & ");
}

// ─── macOS implementations ────────────────────────────────────────────────────

export function macClick(x: number, y: number): string {
	const helper = cliclickPath();
	if (helper) {
		execFileSync(helper, [`c:${x},${y}`], guiHelperExecOptions());
	} else {
		runOsascript(
			`tell application "System Events" to click at {${x}, ${y}}`,
		);
	}
	return `Clicked at (${x}, ${y})`;
}

export function macDoubleClick(x: number, y: number): string {
	const helper = cliclickPath();
	if (helper) {
		execFileSync(helper, [`dc:${x},${y}`], guiHelperExecOptions());
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
	const helper = cliclickPath();
	if (!helper) {
		throw new Error(
			"Right-click requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync(helper, [`rc:${x},${y}`], guiHelperExecOptions());
	return `Right-clicked at (${x}, ${y})`;
}

export function macMove(x: number, y: number): string {
	const helper = cliclickPath();
	if (!helper) {
		throw new Error(
			"Mouse move requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync(helper, [`m:${x},${y}`], guiHelperExecOptions());
	return `Moved cursor to (${x}, ${y})`;
}

export function macDrag(sx: number, sy: number, ex: number, ey: number): string {
	const helper = cliclickPath();
	if (!helper) {
		throw new Error(
			"Drag requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	execFileSync(helper, [`dd:${sx},${sy}`, `du:${ex},${ey}`], guiHelperExecOptions());
	return `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})`;
}

export function macType(text: string): string {
	const helper = cliclickPath();
	if (helper) {
		execFileSync(helper, [`t:${text}`], guiHelperExecOptions());
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
	const helper = cliclickPath();
	if (!helper) {
		throw new Error(
			"Cursor position requires cliclick on macOS. Install: brew install cliclick",
		);
	}
	const out = execFileSync(helper, ["p"], {
		...guiHelperExecOptions(),
		encoding: "utf-8",
	}).trim();
	return `Cursor position: ${out}`;
}
