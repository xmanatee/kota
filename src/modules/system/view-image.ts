import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";

const IMAGE_DETAIL_VALUES = ["resized", "original"] as const;
type ImageDetail = (typeof IMAGE_DETAIL_VALUES)[number];

type ImageDimensions = {
	width: number;
	height: number;
};

type ResizeReadPath = {
	path: string;
	createdTemp: boolean;
};

type ViewImageToolInput = Record<string, unknown>;

type ValidatedViewImageInput = {
	path: string;
	description: string;
	detail: ImageDetail;
};

type ViewImageInputValidation =
	| { ok: true; value: ValidatedViewImageInput }
	| { ok: false; result: ToolResult };

export const viewImageTool: KotaTool = {
	name: "view_image",
	description:
		"Read a local image file and return it for visual analysis. " +
		"Supports PNG, JPEG, GIF, WebP. Defaults to resized fidelity; " +
		"use detail='original' when original pixels are required. Use for: analyzing diagrams, " +
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
			detail: {
				type: "string",
				enum: [...IMAGE_DETAIL_VALUES],
				description:
					"Image fidelity: 'resized' (default) may downscale large images; 'original' returns the original file bytes subject to safety limits.",
			},
		},
		required: ["path"],
		additionalProperties: false,
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

/** Default returned-image dimension cap for resized mode. */
const RESIZED_MAX_DIMENSION = 1568;
/** Max local image bytes accepted by this tool. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RESIZE_TIMEOUT = 10_000;

export async function runViewImage(
	input: ViewImageToolInput,
): Promise<ToolResult> {
	const inputValidation = validateViewImageInput(input);
	if (!inputValidation.ok) return inputValidation.result;

	const { path: rawPath, detail, description } = inputValidation.value;
	if (rawPath.trim() === "") {
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
		if (stat.size > MAX_IMAGE_BYTES) {
			const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
			const limitHint =
				detail === "original"
					? "Request resized fidelity only after reducing the source below the tool limit."
					: "Reduce the source below the tool limit before using view_image.";
			return {
				content:
					`Image too large for ${detail} fidelity (${sizeMB}MB). ` +
					`Maximum: ${formatBytes(MAX_IMAGE_BYTES)}. ${limitHint}`,
				is_error: true,
			};
		}
		const originalBuffer = readFileSync(filePath);
		if (originalBuffer.length > MAX_IMAGE_BYTES) {
			const sizeMB = (originalBuffer.length / (1024 * 1024)).toFixed(1);
			return {
				content:
					`Image too large for ${detail} fidelity (${sizeMB}MB). ` +
					`Maximum: ${formatBytes(MAX_IMAGE_BYTES)}. Reduce the source below the tool limit before using view_image.`,
				is_error: true,
			};
		}
		const originalBytes = originalBuffer.length;
		const originalDimensions = readDimensions(originalBuffer, ext);
		if (originalDimensions instanceof Error) {
			return { content: originalDimensions.message, is_error: true };
		}

		const readPath =
			detail === "resized"
				? tryResize(filePath, ext)
				: { path: filePath, createdTemp: false };

		try {
			const returnedBuffer =
				readPath.path === filePath ? originalBuffer : readFileSync(readPath.path);
			const returnedDimensions =
				readPath.path === filePath
					? originalDimensions
					: readDimensions(returnedBuffer, ext);
			if (returnedDimensions instanceof Error) {
				return { content: returnedDimensions.message, is_error: true };
			}

			const base64 = returnedBuffer.toString("base64");
			const mediaType = MEDIA_TYPES[ext];
			const resized = dimensionsChanged(originalDimensions, returnedDimensions);
			const contextLine = description ? `\nContext: ${description}` : "";
			const textContent =
				`Image loaded: ${rawPath}\n` +
				`Fidelity: ${detail}\n` +
				`Original: ${formatDimensions(originalDimensions)}, ${originalBytes} bytes (${formatBytes(originalBytes)})\n` +
				`Returned: ${formatDimensions(returnedDimensions)}, ${returnedBuffer.length} bytes (${formatBytes(returnedBuffer.length)})\n` +
				`Resized: ${resized ? "yes" : "no"}${contextLine}\n` +
				"Describe what you see in the image.";

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
			if (readPath.createdTemp) {
				try {
					unlinkSync(readPath.path);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn(
						`[view_image] Failed to remove temp file ${readPath.path}: ${msg}`,
					);
				}
			}
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ENOENT")) {
			return { content: `File not found: ${filePath}`, is_error: true };
		}
		return { content: `Cannot access file: ${msg}`, is_error: true };
	}
}

/**
 * Copy to temp file and downscale if needed. Returns the path to read from
 * (temp copy if resized, original if resize not needed or failed).
 * Never modifies the original file.
 */
function tryResize(srcPath: string, ext: string): ResizeReadPath {
	const os = process.platform;
	if (os !== "darwin" && os !== "linux") {
		return { path: srcPath, createdTemp: false };
	}

	try {
		if (os === "darwin") {
			const info = execFileSync("sips", ["-g", "pixelWidth", srcPath], {
				timeout: RESIZE_TIMEOUT,
				stdio: "pipe",
				encoding: "utf-8",
			});
			const match = info.match(/pixelWidth:\s*(\d+)/);
			const width = match ? Number.parseInt(match[1], 10) : 0;
			if (width <= RESIZED_MAX_DIMENSION) {
				return { path: srcPath, createdTemp: false };
			}

			const tmpPath = join(tmpdir(), `kota-viewimg-${Date.now()}${ext}`);
			copyFileSync(srcPath, tmpPath);
			execFileSync(
				"sips",
				[
					"--resampleWidth",
					String(RESIZED_MAX_DIMENSION),
					tmpPath,
					"--out",
					tmpPath,
				],
				{ timeout: RESIZE_TIMEOUT, stdio: "pipe" },
			);
			return { path: tmpPath, createdTemp: true };
		}

		// linux — copy and resize with ImageMagick
		const tmpPath = join(tmpdir(), `kota-viewimg-${Date.now()}${ext}`);
		copyFileSync(srcPath, tmpPath);
		execFileSync(
			"convert",
			[tmpPath, "-resize", `${RESIZED_MAX_DIMENSION}x>`, tmpPath],
			{
				timeout: RESIZE_TIMEOUT,
				stdio: "pipe",
			},
		);
		return { path: tmpPath, createdTemp: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[view_image] Resize skipped for ${srcPath}: ${msg}`);
		return { path: srcPath, createdTemp: false };
	}
}

function validateViewImageInput(input: ViewImageToolInput): ViewImageInputValidation {
	for (const key of Object.keys(input)) {
		if (key !== "path" && key !== "description" && key !== "detail") {
			return {
				ok: false,
				result: {
					content: `Unsupported parameter for view_image: ${key}`,
					is_error: true,
				},
			};
		}
	}
	if (typeof input.path !== "string") {
		return {
			ok: false,
			result: { content: "Missing required parameter: path", is_error: true },
		};
	}
	const detail = input.detail;
	if (detail !== undefined && detail !== "resized" && detail !== "original") {
		return {
			ok: false,
			result: {
				content: "Invalid detail for view_image. Expected 'resized' or 'original'.",
				is_error: true,
			},
		};
	}
	const description = input.description;
	if (description !== undefined && typeof description !== "string") {
		return {
			ok: false,
			result: {
				content: "Invalid description for view_image. Expected a string.",
				is_error: true,
			},
		};
	}
	return {
		ok: true,
		value: {
			path: input.path,
			description: description ?? "",
			detail: detail ?? "resized",
		},
	};
}

function readDimensions(buffer: Buffer, ext: string): ImageDimensions | Error {
	try {
		if (ext === ".png") return readPngDimensions(buffer);
		if (ext === ".jpg" || ext === ".jpeg") return readJpegDimensions(buffer);
		if (ext === ".gif") return readGifDimensions(buffer);
		if (ext === ".webp") return readWebpDimensions(buffer);
		return new Error(`Unsupported image format "${ext}".`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Error(`Cannot read image dimensions: ${msg}`);
	}
}

function readPngDimensions(buffer: Buffer): ImageDimensions {
	if (
		buffer.length < 24 ||
		buffer.readUInt32BE(0) !== 0x89504e47 ||
		buffer.readUInt32BE(4) !== 0x0d0a1a0a ||
		buffer.toString("ascii", 12, 16) !== "IHDR"
	) {
		throw new Error("malformed PNG header");
	}
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
	};
}

function readGifDimensions(buffer: Buffer): ImageDimensions {
	if (buffer.length < 10) throw new Error("malformed GIF header");
	const signature = buffer.toString("ascii", 0, 6);
	if (signature !== "GIF87a" && signature !== "GIF89a") {
		throw new Error("malformed GIF signature");
	}
	return {
		width: buffer.readUInt16LE(6),
		height: buffer.readUInt16LE(8),
	};
}

function readJpegDimensions(buffer: Buffer): ImageDimensions {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		throw new Error("malformed JPEG header");
	}

	let offset = 2;
	while (offset < buffer.length) {
		while (offset < buffer.length && buffer[offset] !== 0xff) offset++;
		while (offset < buffer.length && buffer[offset] === 0xff) offset++;
		if (offset >= buffer.length) break;

		const marker = buffer[offset++];
		if (marker === 0xd9 || marker === 0xda) break;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (offset + 1 >= buffer.length) break;

		const segmentLength = buffer.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > buffer.length) {
			throw new Error("malformed JPEG segment");
		}
		if (isJpegStartOfFrame(marker)) {
			if (segmentLength < 7) throw new Error("malformed JPEG frame");
			return {
				height: buffer.readUInt16BE(offset + 3),
				width: buffer.readUInt16BE(offset + 5),
			};
		}
		offset += segmentLength;
	}
	throw new Error("JPEG dimensions not found");
}

function isJpegStartOfFrame(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function readWebpDimensions(buffer: Buffer): ImageDimensions {
	if (
		buffer.length < 30 ||
		buffer.toString("ascii", 0, 4) !== "RIFF" ||
		buffer.toString("ascii", 8, 12) !== "WEBP"
	) {
		throw new Error("malformed WebP header");
	}

	let offset = 12;
	while (offset + 8 <= buffer.length) {
		const chunkType = buffer.toString("ascii", offset, offset + 4);
		const chunkSize = buffer.readUInt32LE(offset + 4);
		const dataOffset = offset + 8;
		if (dataOffset + chunkSize > buffer.length) {
			throw new Error("malformed WebP chunk");
		}
		if (chunkType === "VP8X") return readWebpVp8xDimensions(buffer, dataOffset);
		if (chunkType === "VP8 ") return readWebpVp8Dimensions(buffer, dataOffset);
		if (chunkType === "VP8L") return readWebpVp8lDimensions(buffer, dataOffset);
		offset = dataOffset + chunkSize + (chunkSize % 2);
	}
	throw new Error("WebP dimensions not found");
}

function readWebpVp8xDimensions(buffer: Buffer, offset: number): ImageDimensions {
	if (offset + 10 > buffer.length) throw new Error("malformed VP8X chunk");
	return {
		width: readUInt24LE(buffer, offset + 4) + 1,
		height: readUInt24LE(buffer, offset + 7) + 1,
	};
}

function readWebpVp8Dimensions(buffer: Buffer, offset: number): ImageDimensions {
	if (
		offset + 10 > buffer.length ||
		buffer[offset + 3] !== 0x9d ||
		buffer[offset + 4] !== 0x01 ||
		buffer[offset + 5] !== 0x2a
	) {
		throw new Error("malformed VP8 chunk");
	}
	return {
		width: buffer.readUInt16LE(offset + 6) & 0x3fff,
		height: buffer.readUInt16LE(offset + 8) & 0x3fff,
	};
}

function readWebpVp8lDimensions(buffer: Buffer, offset: number): ImageDimensions {
	if (offset + 5 > buffer.length || buffer[offset] !== 0x2f) {
		throw new Error("malformed VP8L chunk");
	}
	const packed = buffer.readUInt32LE(offset + 1);
	return {
		width: (packed & 0x3fff) + 1,
		height: ((packed >> 14) & 0x3fff) + 1,
	};
}

function readUInt24LE(buffer: Buffer, offset: number): number {
	return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function dimensionsChanged(
	original: ImageDimensions,
	returned: ImageDimensions,
): boolean {
	return original.width !== returned.width || original.height !== returned.height;
}

function formatDimensions(dimensions: ImageDimensions): string {
	return `${dimensions.width}x${dimensions.height}px`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)}KB`;
	const mb = kb / 1024;
	return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

export const registration = {
	tool: viewImageTool,
	runner: runViewImage,
	effect: readOnlyLocalEffect(),
	group: "gui",
};
