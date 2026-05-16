import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
	calculateDisplayDimensions,
	createScreenshotCoordinateMap,
	type GuiDimensions,
	readPngDimensions,
	rememberLastActionableScreenshot,
	type ScreenshotCoordinateMap,
	type ScreenshotResizeLimits,
} from "./gui-coordinate-scaling.js";

export const screenshotTool: KotaTool = {
	name: "screenshot",
	description:
		"Capture a screenshot of the screen for visual analysis. " +
		"Returns the image plus native/display dimensions and display-to-native scale factors. " +
		"Use coordinate_space=\"last_screenshot_display\" in computer_use for coordinates measured on this image. " +
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

const DEFAULT_RESIZE_LIMITS: ScreenshotResizeLimits = {
	maxLongEdge: 1568,
	maxPixels: 1_200_000,
};
const CAPTURE_TIMEOUT = 10_000;
const RESIZE_TIMEOUT = 10_000;

export type ScreenshotResult =
	| {
			captured: true;
			sizeKB: number;
			coordinateMap: ScreenshotCoordinateMap;
	  }
	| {
			captured: false;
			sizeKB: 0;
			error: string;
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
		} else if (os === "linux") {
			captureLinux(rawPath);
		} else {
			return {
				content: `Screenshot not supported on ${os}. Supported: macOS, Linux.`,
				is_error: true,
			};
		}

		const nativeBuffer = readFileSync(rawPath);
		const nativeDimensions = readPngDimensions(nativeBuffer);
		const targetDisplayDimensions = calculateDisplayDimensions(
			nativeDimensions,
			DEFAULT_RESIZE_LIMITS,
		);
		let resizeSucceeded = false;
		if (!sameDimensions(nativeDimensions, targetDisplayDimensions)) {
			const resized =
				os === "darwin"
					? resizeDarwin(rawPath, nativeDimensions, targetDisplayDimensions)
					: resizeLinux(rawPath, targetDisplayDimensions);
			resizeSucceeded = resized;
		}
		const imageBuffer = readFileSync(rawPath);
		const displayDimensions = resizeSucceeded
			? readPngDimensions(imageBuffer)
			: nativeDimensions;
		const coordinateMap = createScreenshotCoordinateMap(
			nativeDimensions,
			displayDimensions,
		);
		rememberLastActionableScreenshot(coordinateMap);

		const base64 = imageBuffer.toString("base64");
		const sizeKB = Math.round(imageBuffer.length / 1024);
		cleanup(rawPath);

		const contextLine = description ? `\nContext: ${description}` : "";
		const textContent =
			`Screenshot captured (${sizeKB}KB). Native ${nativeDimensions.width}x${nativeDimensions.height}; displayed ${displayDimensions.width}x${displayDimensions.height}; display-to-native scale ${formatScale(coordinateMap.scaleX)}x, ${formatScale(coordinateMap.scaleY)}y. ` +
			`For computer_use coordinate actions, set coordinate_space to "last_screenshot_display" for coordinates measured on this image or "native" for OS coordinates.${contextLine}`;

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
function resizeDarwin(
	path: string,
	native: GuiDimensions,
	display: GuiDimensions,
): boolean {
	try {
		const dimensionFlag =
			display.width !== native.width ? "--resampleWidth" : "--resampleHeight";
		const dimensionValue =
			display.width !== native.width ? display.width : display.height;
		execFileSync(
			"sips",
			[dimensionFlag, String(dimensionValue), path, "--out", path],
			{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
		);
		return true;
	} catch {
		return false;
	}
}

/** Downscale on Linux using ImageMagick convert. The `>` flag prevents upscaling. */
function resizeLinux(path: string, display: GuiDimensions): boolean {
	try {
		execFileSync(
			"convert",
			[path, "-resize", `${display.width}x${display.height}>`, path],
			{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
		);
		return true;
	} catch {
		return false;
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

function sameDimensions(a: GuiDimensions, b: GuiDimensions): boolean {
	return a.width === b.width && a.height === b.height;
}

function formatScale(scale: number): string {
	return Number.isInteger(scale) ? String(scale) : scale.toFixed(4);
}
