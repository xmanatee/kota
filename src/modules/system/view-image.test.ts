import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewImage, viewImageTool } from "./view-image.js";

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
	statSync: vi.fn(),
	unlinkSync: vi.fn(),
	copyFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync, unlinkSync } from "node:fs";

const mockRead = readFileSync as ReturnType<typeof vi.fn>;
const mockStat = statSync as ReturnType<typeof vi.fn>;
const mockUnlink = unlinkSync as ReturnType<typeof vi.fn>;
const mockCopy = copyFileSync as ReturnType<typeof vi.fn>;
const mockExec = execFileSync as ReturnType<typeof vi.fn>;

function pngBuffer(width: number, height: number, totalBytes?: number): Buffer {
	const length = Math.max(totalBytes ?? 33, 33);
	const buffer = Buffer.alloc(length);
	buffer.writeUInt32BE(0x89504e47, 0);
	buffer.writeUInt32BE(0x0d0a1a0a, 4);
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "ascii");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

function jpegBuffer(width: number, height: number): Buffer {
	return Buffer.from([
		0xff, 0xd8,
		0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
		0xff, 0xc0, 0x00, 0x0b, 0x08,
		(height >> 8) & 0xff, height & 0xff,
		(width >> 8) & 0xff, width & 0xff,
		0x01, 0x01, 0x11, 0x00,
		0xff, 0xd9,
	]);
}

function gifBuffer(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(10);
	buffer.write("GIF89a", 0, "ascii");
	buffer.writeUInt16LE(width, 6);
	buffer.writeUInt16LE(height, 8);
	return buffer;
}

function webpBuffer(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(30);
	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(22, 4);
	buffer.write("WEBP", 8, "ascii");
	buffer.write("VP8X", 12, "ascii");
	buffer.writeUInt32LE(10, 16);
	buffer.writeUIntLE(width - 1, 24, 3);
	buffer.writeUIntLE(height - 1, 27, 3);
	return buffer;
}

function imageBufferForPath(path: string): Buffer {
	const lower = path.toLowerCase();
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
		return jpegBuffer(640, 480);
	}
	if (lower.endsWith(".gif")) return gifBuffer(320, 200);
	if (lower.endsWith(".webp")) return webpBuffer(512, 256);
	return pngBuffer(800, 600);
}

describe("runViewImage", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockRead.mockImplementation((path: string) => imageBufferForPath(path));
		mockStat.mockImplementation((path: string) => {
			const buffer = imageBufferForPath(path);
			return { isFile: () => true, size: buffer.length };
		});
		mockUnlink.mockImplementation(() => {});
		mockCopy.mockImplementation(() => {});
	});

	afterEach(() => {
		setPlatform(originalPlatform);
	});

	// --- Missing / invalid input ---

	it("errors on missing path", async () => {
		const result = await runViewImage({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Missing required parameter");
	});

	it("errors on unsupported format", async () => {
		const result = await runViewImage({ path: "/tmp/test.bmp" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unsupported image format");
		expect(result.content).toContain(".bmp");
	});

	it("errors on file not found", async () => {
		mockStat.mockImplementation(() => {
			throw Object.assign(new Error("ENOENT: no such file"), {
				code: "ENOENT",
			});
		});
		const result = await runViewImage({ path: "/tmp/missing.png" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("File not found");
	});

	it("errors on not a file (directory)", async () => {
		mockStat.mockReturnValue({ isFile: () => false, size: 0 });
		const result = await runViewImage({ path: "/tmp/images" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Unsupported image format");
	});

	it("errors on directory with image-like name", async () => {
		mockStat.mockReturnValue({ isFile: () => false, size: 0 });
		const result = await runViewImage({ path: "/tmp/images.png" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Not a file");
	});

	it("errors on file too large", async () => {
		mockStat.mockReturnValue({
			isFile: () => true,
			size: 25 * 1024 * 1024,
		});
		const result = await runViewImage({ path: "/tmp/huge.png" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("too large");
		expect(result.content).toContain("20MB");
	});

	it("errors on oversized original fidelity", async () => {
		mockStat.mockReturnValue({
			isFile: () => true,
			size: 25 * 1024 * 1024,
		});
		const result = await runViewImage({
			path: "/tmp/huge.png",
			detail: "original",
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("too large for original fidelity");
		expect(mockCopy).not.toHaveBeenCalled();
	});

	it("errors on stat failure (non-ENOENT)", async () => {
		mockStat.mockImplementation(() => {
			throw new Error("Permission denied");
		});
		const result = await runViewImage({ path: "/tmp/secret.png" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Cannot access file");
	});

	// --- Successful image loading ---

	it("loads a PNG file and returns image content block", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 800\n";
			return "";
		});

		const imageData = pngBuffer(800, 600, 128);
		mockRead.mockReturnValue(imageData);
		mockStat.mockReturnValue({ isFile: () => true, size: imageData.length });

		const result = await runViewImage({ path: "/tmp/test.png" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Image loaded");
		expect(result.content).toContain("Fidelity: resized");
		expect(result.content).toContain("Original: 800x600px");
		expect(result.content).toContain("Returned: 800x600px");
		expect(result.content).toContain("Resized: no");
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks![0].type).toBe("image");
		expect(result.blocks![1].type).toBe("text");

		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/png");
			expect(result.blocks![0].source.data).toBe(
				imageData.toString("base64"),
			);
		}
	});

	it("declares a strict fidelity option in the tool schema", () => {
		const detail = viewImageTool.input_schema.properties.detail as {
			type: string;
			enum: string[];
		};
		expect(detail.type).toBe("string");
		expect(detail.enum).toEqual(["resized", "original"]);
		expect(viewImageTool.input_schema.additionalProperties).toBe(false);
	});

	it("returns original bytes when original fidelity is requested", async () => {
		setPlatform("darwin");
		const original = pngBuffer(3840, 2160, 256);
		mockRead.mockReturnValue(original);
		mockStat.mockReturnValue({ isFile: () => true, size: original.length });

		const result = await runViewImage({
			path: "/tmp/full.png",
			detail: "original",
		});

		expect(result.is_error).toBeUndefined();
		expect(mockExec).not.toHaveBeenCalled();
		expect(mockCopy).not.toHaveBeenCalled();
		expect(result.content).toContain("Fidelity: original");
		expect(result.content).toContain("Original: 3840x2160px");
		expect(result.content).toContain("Returned: 3840x2160px");
		expect(result.content).toContain("Resized: no");
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.data).toBe(original.toString("base64"));
		}
	});

	it("rejects invalid fidelity detail", async () => {
		const result = await runViewImage({
			path: "/tmp/test.png",
			detail: "full",
		});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Invalid detail");
	});

	it("loads JPEG file with correct media type", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.jpg" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/jpeg");
		}
	});

	it("loads .jpeg module with correct media type", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.jpeg" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/jpeg");
		}
	});

	it("loads GIF file with correct media type", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/anim.gif" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/gif");
		}
	});

	it("loads WebP file with correct media type", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/image.webp" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/webp");
		}
	});

	// --- Description parameter ---

	it("includes description in text content", async () => {
		setPlatform("win32");
		const result = await runViewImage({
			path: "/tmp/chart.png",
			description: "Monthly revenue chart",
		});
		expect(result.content).toContain("Context: Monthly revenue chart");
	});

	it("omits context line when no description", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.png" });
		expect(result.content).not.toContain("Context:");
	});

	// --- Size display ---

	it("shows size in KB", async () => {
		setPlatform("win32");
		const data = pngBuffer(32, 32, 3072);
		mockRead.mockReturnValue(data);
		const result = await runViewImage({ path: "/tmp/photo.png" });
		expect(result.content).toContain("3072 bytes (3KB)");
	});

	// --- Resize on macOS ---

	it("does not resize when image is within the resized max dimension on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1200\n";
			return "";
		});

		await runViewImage({ path: "/tmp/small.png" });

		// Should NOT copy (no resize needed)
		expect(mockCopy).not.toHaveBeenCalled();
	});

	it("copies and resizes when image exceeds the resized max dimension on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 3840\n";
			return "";
		});
		mockRead.mockImplementation((path: string) =>
			path.includes("kota-viewimg")
				? pngBuffer(1568, 882, 128)
				: pngBuffer(3840, 2160, 256),
		);
		mockStat.mockReturnValue({ isFile: () => true, size: 256 });

		const result = await runViewImage({ path: "/tmp/big.png" });

		expect(mockCopy).toHaveBeenCalled();
		expect(mockExec).toHaveBeenCalledWith(
			"sips",
			expect.arrayContaining(["--resampleWidth", "1568"]),
			expect.any(Object),
		);
		expect(result.content).toContain("Original: 3840x2160px");
		expect(result.content).toContain("Returned: 1568x882px");
		expect(result.content).toContain("Resized: yes");
	});

	it("cleans up temp file after resize on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 3840\n";
			return "";
		});

		await runViewImage({ path: "/tmp/big.png" });
		expect(mockUnlink).toHaveBeenCalled();
	});

	it("handles sips resize failure gracefully on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 4000\n";
			if (cmd === "sips" && (args as string[]).includes("--resampleWidth"))
				throw new Error("sips failed");
			return "";
		});

		const result = await runViewImage({ path: "/tmp/big.png" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Image loaded");
	});

	// --- Resize on Linux ---

	it("copies and resizes on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation(() => "");
		mockRead.mockImplementation((path: string) =>
			path.includes("kota-viewimg")
				? pngBuffer(1568, 882, 128)
				: pngBuffer(3840, 2160, 256),
		);
		mockStat.mockReturnValue({ isFile: () => true, size: 256 });

		const result = await runViewImage({ path: "/tmp/photo.png" });

		expect(mockCopy).toHaveBeenCalled();
		expect(mockExec).toHaveBeenCalledWith(
			"convert",
			expect.arrayContaining(["-resize", "1568x>"]),
			expect.any(Object),
		);
		expect(result.content).toContain("Resized: yes");
	});

	it("cleans up temp file after resize on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation(() => "");

		await runViewImage({ path: "/tmp/photo.png" });
		expect(mockUnlink).toHaveBeenCalled();
	});

	it("handles convert failure gracefully on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation(() => {
			throw new Error("convert not found");
		});

		const result = await runViewImage({ path: "/tmp/photo.png" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Image loaded");
	});

	// --- Unsupported platform ---

	it("skips resize on unsupported platform", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.png" });
		expect(result.is_error).toBeUndefined();
		expect(mockExec).not.toHaveBeenCalled();
		expect(mockCopy).not.toHaveBeenCalled();
	});

	// --- Case-insensitive module ---

	it("handles uppercase modules", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.PNG" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/png");
		}
	});

	it("handles mixed-case modules", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.JpEg" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/jpeg");
		}
	});

	// --- Original path in output ---

	it("shows original path (not resolved) in output", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "./images/chart.png" });
		expect(result.content).toContain("./images/chart.png");
	});
});
