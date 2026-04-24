import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/tool-result.js";

export const screenshotTool: KotaTool = {
	name: "screenshot",
	description:
		"Capture a screenshot of the screen for visual analysis. " +
		"Returns the image so you can see what's on screen. " +
		"Use for: reading on-screen content, debugging UIs, monitoring dashboards, " +
		"understanding visual context, extracting data from charts/graphs.",
	input_schema: {
		type: "object" as const,
		properties: {
			description: {
				type: "string",
				description:
					"Optional context about what to look for in the screenshot",
			},
		},
		required: [],
	},
};

/** Max image dimension (pixels) — Claude's optimal limit. */
const MAX_DIM = 1568;
const CAPTURE_TIMEOUT = 10_000;
const RESIZE_TIMEOUT = 10_000;

export type ScreenshotResult = {
	captured: boolean;
	sizeKB: number;
	error?: string;
};

export async function runScreenshot(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const description = (input.description as string) || "";
	const os = process.platform;
	const rawPath = join(tmpdir(), `kota-screenshot-${Date.now()}.png`);

	try {
		if (os === "darwin") {
			captureDarwin(rawPath);
			resizeDarwin(rawPath);
		} else if (os === "linux") {
			captureLinux(rawPath);
			resizeLinux(rawPath);
		} else {
			return {
				content: `Screenshot not supported on ${os}. Supported: macOS, Linux.`,
				is_error: true,
			};
		}

		const imageBuffer = readFileSync(rawPath);
		const base64 = imageBuffer.toString("base64");
		const sizeKB = Math.round(imageBuffer.length / 1024);
		cleanup(rawPath);

		const contextLine = description ? `\nContext: ${description}` : "";
		const textContent = `Screenshot captured (${sizeKB}KB).${contextLine}\nDescribe what you see in the image.`;

		return {
			content: textContent,
			blocks: [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: base64,
					},
				},
				{ type: "text", text: textContent },
			],
		};
	} catch (err) {
		cleanup(rawPath);
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ENOENT")) {
			return {
				content: `Screenshot requires system utilities. ${platformHint(os)}. Error: ${msg}`,
				is_error: true,
			};
		}
		return { content: `Screenshot failed: ${msg}`, is_error: true };
	}
}

function captureDarwin(path: string): void {
	execFileSync("screencapture", ["-x", "-t", "png", path], {
		timeout: CAPTURE_TIMEOUT,
		stdio: "pipe",
	});
}

function captureLinux(path: string): void {
	const commands: [string, string[]][] = [
		["gnome-screenshot", ["-f", path]],
		["scrot", [path]],
		["import", ["-window", "root", path]],
	];
	for (const [cmd, args] of commands) {
		try {
			execFileSync(cmd, args, { timeout: CAPTURE_TIMEOUT, stdio: "pipe" });
			return;
		} catch {
		}
	}
	throw new Error(
		"No screenshot utility found. Install one of: gnome-screenshot, scrot, or ImageMagick (import).",
	);
}

/** Downscale on macOS using sips (always available). Only shrinks, never upscales. */
function resizeDarwin(path: string): void {
	try {
		const info = execFileSync("sips", ["-g", "pixelWidth", path], {
			timeout: RESIZE_TIMEOUT,
			stdio: "pipe",
			encoding: "utf-8",
		});
		const match = info.match(/pixelWidth:\s*(\d+)/);
		const width = match ? Number.parseInt(match[1], 10) : 0;
		if (width > MAX_DIM) {
			execFileSync(
				"sips",
				["--resampleWidth", String(MAX_DIM), path, "--out", path],
				{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
			);
		}
	} catch {
		// Resize failed — use original resolution
	}
}

/** Downscale on Linux using ImageMagick convert. The `>` flag prevents upscaling. */
function resizeLinux(path: string): void {
	try {
		execFileSync(
			"convert",
			[path, "-resize", `${MAX_DIM}x>`, path],
			{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
		);
	} catch {
		// ImageMagick not available — use original resolution
	}
}

function cleanup(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Already deleted or never created
	}
}

function platformHint(os: string): string {
	if (os === "darwin") return "screencapture should be available on macOS";
	if (os === "linux")
		return "Install gnome-screenshot, scrot, or ImageMagick";
	return `Platform "${os}" is not supported`;
}
export const registration = {
	tool: screenshotTool,
	runner: runScreenshot,
	risk: "safe" as const,
	kind: "discovery" as const,
	group: "gui",
};
