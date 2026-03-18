import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
	platform: vi.fn(),
}));

const { execFileSync } = await import("node:child_process");
const { platform } = await import("node:os");
const mockExec = vi.mocked(execFileSync);
const mockPlatform = vi.mocked(platform);

const { readClipboard, writeClipboard, runClipboard } = await import("./clipboard.js");

beforeEach(() => {
	mockExec.mockReset();
	mockPlatform.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("clipboard tool", () => {
	describe("readClipboard", () => {
		it("returns error for unsupported platform", () => {
			mockPlatform.mockReturnValue("freebsd" as NodeJS.Platform);
			const result = readClipboard();
			expect(result.error).toContain("not supported");
			expect(result.text).toBe("");
			expect(mockExec).not.toHaveBeenCalled();
		});

		it("reads clipboard on macOS via pbpaste", () => {
			mockPlatform.mockReturnValue("darwin");
			mockExec.mockReturnValue(Buffer.from("clipboard content"));
			const result = readClipboard();
			expect(result.error).toBeUndefined();
			expect(result.text).toBe("clipboard content");
			expect(mockExec).toHaveBeenCalledWith(
				"pbpaste",
				[],
				expect.objectContaining({ timeout: 5000 }),
			);
		});

		it("reads clipboard on Linux via xclip", () => {
			mockPlatform.mockReturnValue("linux");
			mockExec.mockReturnValue(Buffer.from("linux clipboard"));
			const result = readClipboard();
			expect(result.error).toBeUndefined();
			expect(result.text).toBe("linux clipboard");
			expect(mockExec).toHaveBeenCalledWith(
				"xclip",
				["-selection", "clipboard", "-o"],
				expect.objectContaining({ timeout: 5000 }),
			);
		});

		it("returns error when command not found", () => {
			mockPlatform.mockReturnValue("darwin");
			const err = new Error("not found") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			mockExec.mockImplementation(() => { throw err; });
			const result = readClipboard();
			expect(result.error).toContain("pbpaste not found");
			expect(result.text).toBe("");
		});
	});

	describe("writeClipboard", () => {
		it("returns error for unsupported platform", () => {
			mockPlatform.mockReturnValue("freebsd" as NodeJS.Platform);
			const result = writeClipboard("hello");
			expect(result.ok).toBe(false);
			expect(result.error).toContain("not supported");
			expect(mockExec).not.toHaveBeenCalled();
		});

		it("writes to clipboard on macOS via pbcopy", () => {
			mockPlatform.mockReturnValue("darwin");
			const result = writeClipboard("test text");
			expect(result.ok).toBe(true);
			expect(mockExec).toHaveBeenCalledWith(
				"pbcopy",
				[],
				expect.objectContaining({ input: "test text", timeout: 5000 }),
			);
		});

		it("writes to clipboard on Linux via xclip", () => {
			mockPlatform.mockReturnValue("linux");
			const result = writeClipboard("test text");
			expect(result.ok).toBe(true);
			expect(mockExec).toHaveBeenCalledWith(
				"xclip",
				["-selection", "clipboard"],
				expect.objectContaining({ input: "test text", timeout: 5000 }),
			);
		});

		it("returns error when command not found", () => {
			mockPlatform.mockReturnValue("darwin");
			const err = new Error("not found") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			mockExec.mockImplementation(() => { throw err; });
			const result = writeClipboard("text");
			expect(result.ok).toBe(false);
			expect(result.error).toContain("pbcopy not found");
		});
	});

	describe("runClipboard", () => {
		it("rejects unknown action", async () => {
			const result = await runClipboard({ action: "delete" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("unknown action");
		});

		it("requires text for write action", async () => {
			const result = await runClipboard({ action: "write" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("text is required");
		});

		it("rejects text exceeding max length", async () => {
			const longText = "x".repeat(100_001);
			const result = await runClipboard({ action: "write", text: longText });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("too long");
		});

		it("reads clipboard via tool runner", async () => {
			mockPlatform.mockReturnValue("darwin");
			mockExec.mockReturnValue(Buffer.from("read via runner"));
			const result = await runClipboard({ action: "read" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toBe("read via runner");
		});

		it("returns empty message when clipboard is empty", async () => {
			mockPlatform.mockReturnValue("darwin");
			mockExec.mockReturnValue(Buffer.from(""));
			const result = await runClipboard({ action: "read" });
			expect(result.content).toBe("(clipboard is empty)");
		});

		it("writes clipboard via tool runner", async () => {
			mockPlatform.mockReturnValue("darwin");
			const result = await runClipboard({ action: "write", text: "hello" });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("5 chars to clipboard");
		});

		it("truncates oversized read results", async () => {
			mockPlatform.mockReturnValue("darwin");
			const big = "x".repeat(60_000);
			mockExec.mockReturnValue(Buffer.from(big));
			const result = await runClipboard({ action: "read" });
			expect(result.content).toContain("Truncated");
			expect(result.content).toContain("60000 chars total");
		});
	});
});
