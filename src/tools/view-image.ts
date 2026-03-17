import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const viewImageTool: Anthropic.Tool = {
	name: "view_image",
	description:
		"Read a local image file and return it for visual analysis. " +
		"Supports PNG, JPEG, GIF, WebP. Use for: analyzing diagrams, " +
		"extracting text from photos, understanding charts/graphs, " +
		"examining UI mockups, reading handwritten notes.",
	input_schema: {
		type: "object" as const,
		properties: {
			path: {
				type: "string",
				description: "Path to the image file (absolute or relative to cwd)",
			},
			description: {
				type: "string",
				description:
					"Optional context about what to look for in the image",
			},
		},
		required: ["path"],
	},
};

const MEDIA_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

const SUPPORTED_EXTS = Object.keys(MEDIA_TYPES);

/** Max image dimension (pixels) — Claude's optimal limit. */
const MAX_DIM = 1568;
/** Max file size: 20MB (Claude's limit for base64 images). */
const MAX_SIZE = 20 * 1024 * 1024;
const RESIZE_TIMEOUT = 10_000;

export async function runViewImage(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const rawPath = input.path as string;
	if (!rawPath) {
		return { content: "Missing required parameter: path", is_error: true };
	}

	const filePath = resolve(rawPath);
	const ext = extname(filePath).toLowerCase();

	if (!SUPPORTED_EXTS.includes(ext)) {
		return {
			content: `Unsupported image format "${ext}". Supported: ${SUPPORTED_EXTS.join(", ")}`,
			is_error: true,
		};
	}

	try {
		const stat = statSync(filePath);
		if (!stat.isFile()) {
			return { content: `Not a file: ${filePath}`, is_error: true };
		}
		if (stat.size > MAX_SIZE) {
			const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
			return {
				content: `Image too large (${sizeMB}MB). Maximum: 20MB.`,
				is_error: true,
			};
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ENOENT")) {
			return { content: `File not found: ${filePath}`, is_error: true };
		}
		return { content: `Cannot access file: ${msg}`, is_error: true };
	}

	const readPath = tryResize(filePath, ext);

	try {
		const imageBuffer = readFileSync(readPath);
		const base64 = imageBuffer.toString("base64");
		const sizeKB = Math.round(imageBuffer.length / 1024);
		const mediaType = MEDIA_TYPES[ext];
		const description = (input.description as string) || "";
		const contextLine = description ? `\nContext: ${description}` : "";
		const textContent = `Image loaded: ${rawPath} (${sizeKB}KB).${contextLine}\nDescribe what you see in the image.`;

		return {
			content: textContent,
			blocks: [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: mediaType,
						data: base64,
					},
				},
				{ type: "text", text: textContent },
			],
		};
	} finally {
		if (readPath !== filePath) {
			try {
				unlinkSync(readPath);
			} catch {
				// cleanup best-effort
			}
		}
	}
}

/**
 * Copy to temp file and downscale if needed. Returns the path to read from
 * (temp copy if resized, original if resize not needed or failed).
 * Never modifies the original file.
 */
function tryResize(srcPath: string, ext: string): string {
	const os = process.platform;
	if (os !== "darwin" && os !== "linux") return srcPath;

	try {
		if (os === "darwin") {
			const info = execFileSync("sips", ["-g", "pixelWidth", srcPath], {
				timeout: RESIZE_TIMEOUT,
				stdio: "pipe",
				encoding: "utf-8",
			});
			const match = info.match(/pixelWidth:\s*(\d+)/);
			const width = match ? Number.parseInt(match[1], 10) : 0;
			if (width <= MAX_DIM) return srcPath;

			const tmpPath = join(tmpdir(), `kota-viewimg-${Date.now()}${ext}`);
			copyFileSync(srcPath, tmpPath);
			execFileSync(
				"sips",
				["--resampleWidth", String(MAX_DIM), tmpPath, "--out", tmpPath],
				{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
			);
			return tmpPath;
		}

		// linux — copy and resize with ImageMagick
		const tmpPath = join(tmpdir(), `kota-viewimg-${Date.now()}${ext}`);
		copyFileSync(srcPath, tmpPath);
		execFileSync("convert", [tmpPath, "-resize", `${MAX_DIM}x>`, tmpPath], {
			timeout: RESIZE_TIMEOUT,
			stdio: "pipe",
		});
		return tmpPath;
	} catch {
		return srcPath;
	}
}

export const registration = {
	tool: viewImageTool,
	runner: runViewImage,
	risk: "safe" as const,
	group: "gui",
};
