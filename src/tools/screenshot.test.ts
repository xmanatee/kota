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

describe("runScreenshot", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		// Default: return a small PNG buffer
		const fakePng = Buffer.from("fake-png-data");
		mockRead.mockReturnValue(fakePng);
		mockUnlink.mockImplementation(() => {});
	});

	afterEach(() => {
		setPlatform(originalPlatform);
	});

	// --- macOS ---

	it("captures screenshot on macOS", async () => {
		setPlatform("darwin");
		// sips -g pixelWidth returns width < MAX_DIM, so no resize
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1024\n";
			return "";
		});

		const result = await runScreenshot({});
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Screenshot captured");
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

	it("resizes when image exceeds MAX_DIM on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 3840\n";
			return "";
		});

		await runScreenshot({});

		// Should call sips --resampleWidth
		expect(mockExec).toHaveBeenCalledWith(
			"sips",
			expect.arrayContaining(["--resampleWidth", "1568"]),
			expect.any(Object),
		);
	});

	it("skips resize when image is within MAX_DIM on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1200\n";
			return "";
		});

		await runScreenshot({});

		// Should NOT call sips --resampleWidth
		const resizeCalls = mockExec.mock.calls.filter(
			(call: unknown[]) =>
				call[0] === "sips" && (call[1] as string[]).includes("--resampleWidth"),
		);
		expect(resizeCalls).toHaveLength(0);
	});

	it("handles sips resize failure gracefully on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 4000\n";
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
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1024\n";
			return "";
		});

		const result = await runScreenshot({
			description: "Check the error dialog",
		});
		expect(result.content).toContain("Context: Check the error dialog");
	});

	it("omits context line when no description", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 1024\n";
			return "";
		});

		const result = await runScreenshot({});
		expect(result.content).not.toContain("Context:");
	});

	// --- Image content ---

	it("returns base64-encoded image in blocks", async () => {
		setPlatform("darwin");
		const pngData = Buffer.from("test-image-data");
		mockRead.mockReturnValue(pngData);
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 800\n";
			return "";
		});

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
		// 2048 bytes = 2KB
		const bigPng = Buffer.alloc(2048, 0);
		mockRead.mockReturnValue(bigPng);
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 500\n";
			return "";
		});

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
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "sips" && args[0] === "-g") return "pixelWidth: 800\n";
			return "";
		});

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
