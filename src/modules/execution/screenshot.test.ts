import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScreenshot } from "./screenshot.js";

// Mock child_process so we never actually capture screenshots
vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

// Mock fs operations
vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;
const mockUnlink = unlinkSync as ReturnType<typeof vi.fn>;

function pngBuffer(width: number, height: number, size = 64): Buffer {
	const buffer = Buffer.alloc(Math.max(size, 32), 0);
	Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "ascii");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

describe("runScreenshot", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: return a small PNG buffer
		const fakePng = pngBuffer(1024, 768);
		mockRead.mockReturnValue(fakePng);
		mockUnlink.mockImplementation(() => {});
	});

	afterEach(() => {
		setPlatform(originalPlatform);
	});

	// --- macOS ---

	it("captures screenshot on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockReturnValue("");

		const result = await runScreenshot({});
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Screenshot captured");
		expect(result.content).toContain("Native 1024x768");
		expect(result.content).toContain("displayed 1024x768");
		expect(result.content).toContain('coordinate_space to "last_screenshot_display"');
		expect(result.blocks).toBeDefined();
		expect(result.blocks).toHaveLength(2);
		expect(result.blocks![0].type).toBe("image");
		expect(result.blocks![1].type).toBe("text");

		// Verify screencapture was called
		expect(mockExec).toHaveBeenCalledWith(
			"screencapture",
			expect.arrayContaining(["-x", "-t", "png"]),
			expect.any(Object),
		);
	});

	it("resizes when image exceeds the max long edge on macOS", async () => {
		setPlatform("darwin");
		mockRead
			.mockReturnValueOnce(pngBuffer(1600, 700))
			.mockReturnValue(pngBuffer(1568, 686));
		mockExec.mockReturnValue("");

		const result = await runScreenshot({});

		expect(mockExec).toHaveBeenCalledWith(
			"sips",
			expect.arrayContaining(["--resampleWidth", "1568"]),
			expect.any(Object),
		);
		expect(result.content).toContain("Native 1600x700");
		expect(result.content).toContain("displayed 1568x686");
	});

	it("skips resize when image is within MAX_DIM on macOS", async () => {
		setPlatform("darwin");
		mockRead.mockReturnValue(pngBuffer(1200, 800));
		mockExec.mockReturnValue("");

		await runScreenshot({});

		const resizeCalls = mockExec.mock.calls.filter(
			(call: unknown[]) =>
				call[0] === "sips" && (call[1] as string[]).includes("--resampleWidth"),
		);
		expect(resizeCalls).toHaveLength(0);
	});

	it("handles sips resize failure gracefully on macOS", async () => {
		setPlatform("darwin");
		mockRead.mockReturnValue(pngBuffer(1600, 700));
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && (args as string[]).includes("--resampleWidth"))
				throw new Error("sips failed");
			return "";
		});

		const result = await runScreenshot({});
		// Should still succeed — resize failure is non-fatal
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Screenshot captured");
	});

	// --- Linux ---

	it("captures screenshot on Linux with gnome-screenshot", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "gnome-screenshot") return "";
			if (cmd === "convert") return "";
			throw new Error("unexpected");
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Screenshot captured");
	});

	it("falls back to scrot on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "gnome-screenshot") throw new Error("not found");
			if (cmd === "scrot") return "";
			if (cmd === "convert") return "";
			throw new Error("unexpected");
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBeUndefined();
		expect(result.blocks).toBeDefined();
	});

	it("falls back to import on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "gnome-screenshot") throw new Error("not found");
			if (cmd === "scrot") throw new Error("not found");
			if (cmd === "import") return "";
			if (cmd === "convert") return "";
			throw new Error("unexpected");
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBeUndefined();
	});

	it("errors when no Linux screenshot utility is found", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "gnome-screenshot") throw new Error("not found");
			if (cmd === "scrot") throw new Error("not found");
			if (cmd === "import") throw new Error("not found");
			return "";
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("No screenshot utility found");
	});

	it("handles convert resize failure gracefully on Linux", async () => {
		setPlatform("linux");
		mockRead.mockReturnValue(pngBuffer(1600, 700));
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "gnome-screenshot") return "";
			if (cmd === "convert") throw new Error("convert not found");
			throw new Error("unexpected");
		});

		const result = await runScreenshot({});
		// Should still succeed — resize failure is non-fatal
		expect(result.is_error).toBeUndefined();
	});

	// --- Unsupported platform ---

	it("returns error on unsupported platform", async () => {
		setPlatform("win32");
		const result = await runScreenshot({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not supported");
		expect(result.content).toContain("win32");
	});

	// --- Description parameter ---

	it("includes description in text content", async () => {
		setPlatform("darwin");
		mockExec.mockReturnValue("");

		const result = await runScreenshot({
			description: "Check the error dialog",
		});
		expect(result.content).toContain("Context: Check the error dialog");
	});

	it("omits context line when no description", async () => {
		setPlatform("darwin");
		mockExec.mockReturnValue("");

		const result = await runScreenshot({});
		expect(result.content).not.toContain("Context:");
	});

	// --- Image content ---

	it("returns base64-encoded image in blocks", async () => {
		setPlatform("darwin");
		const pngData = pngBuffer(800, 600);
		mockRead.mockReturnValue(pngData);
		mockExec.mockReturnValue("");

		const result = await runScreenshot({});
		const imageBlock = result.blocks?.find((b) => b.type === "image");
		expect(imageBlock).toBeDefined();
		if (imageBlock?.type === "image") {
			expect(imageBlock.source.type).toBe("base64");
			expect(imageBlock.source.media_type).toBe("image/png");
			expect(imageBlock.source.data).toBe(pngData.toString("base64"));
		}
	});

	it("shows size in KB", async () => {
		setPlatform("darwin");
		const bigPng = pngBuffer(500, 500, 2048);
		mockRead.mockReturnValue(bigPng);
		mockExec.mockReturnValue("");

		const result = await runScreenshot({});
		expect(result.content).toContain("2KB");
	});

	// --- Error handling ---

	it("handles screencapture ENOENT error", async () => {
		setPlatform("darwin");
		const err = new Error("spawn screencapture ENOENT");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "screencapture") throw err;
			return "";
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("ENOENT");
		expect(result.content).toContain("screencapture");
	});

	it("handles generic capture error", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "screencapture") throw new Error("Permission denied");
			return "";
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Screenshot failed");
		expect(result.content).toContain("Permission denied");
	});

	// --- Cleanup ---

	it("cleans up temp file after successful capture", async () => {
		setPlatform("darwin");
		mockExec.mockReturnValue("");

		await runScreenshot({});
		expect(mockUnlink).toHaveBeenCalled();
	});

	it("cleans up temp file after error", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "screencapture") throw new Error("failed");
			return "";
		});

		await runScreenshot({});
		expect(mockUnlink).toHaveBeenCalled();
	});
});
