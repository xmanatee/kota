import { execFileSync } from "node:child_process";
import { EXEC_OPTS, parseCombo, truncText } from "./computer-use-actions-shared.js";
import { resolveTrustedGuiHelper } from "./computer-use-trusted-executables.js";

// ─── Key mappings ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _xdotoolPath: string | null | undefined;

export function resetLinuxState(): void {
	_xdotoolPath = undefined;
}

function xdotoolPath(): string | null {
	if (_xdotoolPath === undefined) {
		_xdotoolPath = resolveTrustedGuiHelper("xdotool");
	}
	return _xdotoolPath;
}

function requireXdotool(): string {
	const path = xdotoolPath();
	if (!path) {
		throw new Error(
			"xdotool required on Linux. Install: sudo apt install xdotool",
		);
	}
	return path;
}

function xdotool(...args: string[]): string {
	return execFileSync(requireXdotool(), args, {
		...EXEC_OPTS,
		encoding: "utf-8",
	}).trim();
}

// ─── Linux implementations ────────────────────────────────────────────────────

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
