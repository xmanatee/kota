import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const notifyTool: Anthropic.Tool = {
	name: "notify",
	description:
		"Send a desktop notification to the user. Use to alert about completed tasks, " +
		"monitoring events, or anything that needs attention when the user may not be watching the terminal.",
	input_schema: {
		type: "object" as const,
		properties: {
			message: {
				type: "string",
				description: "Notification body text",
			},
			title: {
				type: "string",
				description: 'Notification title (default: "KOTA")',
			},
			sound: {
				type: "boolean",
				description: "Play a sound with the notification (default: true)",
			},
		},
		required: ["message"],
	},
};

export type NotifyChannel = "desktop" | "console";

export type NotifyResult = {
	channel: NotifyChannel;
	delivered: boolean;
	error?: string;
};

/**
 * Send a desktop notification.
 * macOS: osascript (display notification)
 * Linux: notify-send
 * Fallback: console output
 *
 * @param _platform — override for testing (defaults to os.platform())
 */
export function sendDesktopNotification(
	message: string,
	title = "KOTA",
	sound = true,
	_platform?: string,
): NotifyResult {
	const os = _platform ?? platform();

	if (os === "darwin") {
		return sendMacNotification(message, title, sound);
	}
	if (os === "linux") {
		return sendLinuxNotification(message, title);
	}

	return sendConsoleNotification(message, title);
}

function sendMacNotification(
	message: string,
	title: string,
	sound: boolean,
): NotifyResult {
	const soundClause = sound ? ' sound name "Glass"' : "";
	const script = `display notification ${escapeAppleScript(message)} with title ${escapeAppleScript(title)}${soundClause}`;
	try {
		execFileSync("osascript", ["-e", script], { timeout: 5000 });
		return { channel: "desktop", delivered: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { channel: "desktop", delivered: false, error: msg };
	}
}

function sendLinuxNotification(
	message: string,
	title: string,
): NotifyResult {
	try {
		execFileSync("notify-send", [title, message], { timeout: 5000 });
		return { channel: "desktop", delivered: true };
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			return {
				channel: "desktop",
				delivered: false,
				error: "notify-send not found. Install: apt install libnotify-bin",
			};
		}
		const msg = err instanceof Error ? err.message : String(err);
		return { channel: "desktop", delivered: false, error: msg };
	}
}

function sendConsoleNotification(
	message: string,
	title: string,
): NotifyResult {
	process.stderr.write(`\n🔔 [${title}] ${message}\n`);
	return { channel: "console", delivered: true };
}

function escapeAppleScript(str: string): string {
	const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return `"${escaped}"`;
}

export async function runNotify(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const message = input.message as string;
	if (!message || !message.trim()) {
		return { content: "Error: message is required", is_error: true };
	}

	const title = (input.title as string) || "KOTA";
	const sound = input.sound !== false;

	const result = sendDesktopNotification(message, title, sound);

	if (result.delivered) {
		return {
			content: `Notification sent (${result.channel}): ${title} — ${message}`,
		};
	}

	// Desktop failed — fall back to console
	const fallback = sendConsoleNotification(message, title);
	return {
		content:
			`Desktop notification failed: ${result.error}\n` +
			`Fallback: console notification ${fallback.delivered ? "sent" : "failed"}.`,
	};
}
export const registration = {
	tool: notifyTool,
	runner: runNotify,
	risk: "safe" as const,
	group: "management",
};
