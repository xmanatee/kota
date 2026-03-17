import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runViewImage } from "./view-image.js";

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

describe("runViewImage", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		const fakePng = Buffer.from("fake-png-data");
		mockRead.mockReturnValue(fakePng);
		mockStat.mockReturnValue({ isFile: () => true, size: 1024 });
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

		const pngData = Buffer.from("test-png-data");
		mockRead.mockReturnValue(pngData);

		const result = await runViewImage({ path: "/tmp/test.png" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Image loaded");
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks![0].type).toBe("image");
		expect(result.blocks![1].type).toBe("text");

		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/png");
			expect(result.blocks![0].source.data).toBe(
				pngData.toString("base64"),
			);
		}
	});

	it("loads JPEG file with correct media type", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.jpg" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/jpeg");
		}
	});

	it("loads .jpeg extension with correct media type", async () => {
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
		const data = Buffer.alloc(3072, 0);
		mockRead.mockReturnValue(data);
		const result = await runViewImage({ path: "/tmp/photo.png" });
		expect(result.content).toContain("3KB");
	});

	// --- Resize on macOS ---

	it("does not resize when image is within MAX_DIM on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1200\n";
			return "";
		});

		await runViewImage({ path: "/tmp/small.png" });

		// Should NOT copy (no resize needed)
		expect(mockCopy).not.toHaveBeenCalled();
	});

	it("copies and resizes when image exceeds MAX_DIM on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 3840\n";
			return "";
		});

		await runViewImage({ path: "/tmp/big.png" });

		expect(mockCopy).toHaveBeenCalled();
		expect(mockExec).toHaveBeenCalledWith(
			"sips",
			expect.arrayContaining(["--resampleWidth", "1568"]),
			expect.any(Object),
		);
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

		await runViewImage({ path: "/tmp/photo.png" });

		expect(mockCopy).toHaveBeenCalled();
		expect(mockExec).toHaveBeenCalledWith(
			"convert",
			expect.arrayContaining(["-resize", "1568x>"]),
			expect.any(Object),
		);
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

	// --- Case-insensitive extension ---

	it("handles uppercase extensions", async () => {
		setPlatform("win32");
		const result = await runViewImage({ path: "/tmp/photo.PNG" });
		expect(result.is_error).toBeUndefined();
		if (result.blocks![0].type === "image") {
			expect(result.blocks![0].source.media_type).toBe("image/png");
		}
	});

	it("handles mixed-case extensions", async () => {
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
