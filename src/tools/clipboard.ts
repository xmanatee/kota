import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const clipboardTool: Anthropic.Tool = {
	name: "clipboard",
	description:
		"Read from or write to the system clipboard. Use to grab what the user copied " +
		"(text, URLs, code snippets) or to put results where the user can paste them into other apps.",
	input_schema: {
		type: "object" as const,
		properties: {
			action: {
				type: "string",
				enum: ["read", "write"],
				description: "read: get current clipboard text. write: set clipboard text.",
			},
			text: {
				type: "string",
				description: "Text to write to clipboard (required for write action)",
			},
		},
		required: ["action"],
	},
};

const MAX_WRITE_LENGTH = 100_000;
const MAX_READ_LENGTH = 50_000;

/**
 * Read text from the system clipboard.
 * macOS: pbpaste
 * Linux: xclip -selection clipboard -o
 */
export function readClipboard(): { text: string; error?: string } {
	const os = platform();

	if (os === "darwin") {
		return execClipboard("pbpaste", [], "read");
	}
	if (os === "linux") {
		return execClipboard("xclip", ["-selection", "clipboard", "-o"], "read");
	}
	return { text: "", error: `Clipboard not supported on ${os}. Supported: macOS, Linux.` };
}

/**
 * Write text to the system clipboard.
 * macOS: pbcopy
 * Linux: xclip -selection clipboard
 */
export function writeClipboard(text: string): { ok: boolean; error?: string } {
	const os = platform();

	if (os === "darwin") {
		return execClipboardWrite("pbcopy", [], text);
	}
	if (os === "linux") {
		return execClipboardWrite("xclip", ["-selection", "clipboard"], text);
	}
	return { ok: false, error: `Clipboard not supported on ${os}. Supported: macOS, Linux.` };
}

function execClipboard(
	cmd: string,
	args: string[],
	_op: string,
): { text: string; error?: string } {
	try {
		const output = execFileSync(cmd, args, { timeout: 5000, maxBuffer: MAX_READ_LENGTH * 2 });
		return { text: output.toString("utf-8") };
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			return { text: "", error: `${cmd} not found. Install it to use clipboard.` };
		}
		const msg = err instanceof Error ? err.message : String(err);
		return { text: "", error: msg };
	}
}

function execClipboardWrite(
	cmd: string,
	args: string[],
	text: string,
): { ok: boolean; error?: string } {
	try {
		execFileSync(cmd, args, { input: text, timeout: 5000 });
		return { ok: true };
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			return { ok: false, error: `${cmd} not found. Install it to use clipboard.` };
		}
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: msg };
	}
}

export async function runClipboard(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const action = input.action as string;

	if (action === "read") {
		const result = readClipboard();
		if (result.error) {
			return { content: `Clipboard read error: ${result.error}`, is_error: true };
		}
		if (!result.text) {
			return { content: "(clipboard is empty)" };
		}
		let text = result.text;
		if (text.length > MAX_READ_LENGTH) {
			text = text.slice(0, MAX_READ_LENGTH) +
				`\n[Truncated — ${result.text.length} chars total, showing first ${MAX_READ_LENGTH}]`;
		}
		return { content: text };
	}

	if (action === "write") {
		const text = input.text as string;
		if (!text) {
			return { content: "Error: text is required for write action", is_error: true };
		}
		if (text.length > MAX_WRITE_LENGTH) {
			return {
				content: `Error: text too long (${text.length} chars). Maximum: ${MAX_WRITE_LENGTH}.`,
				is_error: true,
			};
		}
		const result = writeClipboard(text);
		if (!result.ok) {
			return { content: `Clipboard write error: ${result.error}`, is_error: true };
		}
		return { content: `Copied ${text.length} chars to clipboard.` };
	}

	return { content: `Error: unknown action "${action}". Use read or write.`, is_error: true };
}
export const registration = {
	tool: clipboardTool,
	runner: runClipboard,
	risk: "safe" as const,
	group: "gui",
};
