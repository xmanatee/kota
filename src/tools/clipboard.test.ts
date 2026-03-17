import { describe, expect, it } from "vitest";
import { readClipboard, runClipboard, writeClipboard } from "./clipboard.js";

describe("clipboard tool", () => {
	describe("readClipboard", () => {
		it("returns error for unsupported platform", () => {
			const result = readClipboard("freebsd");
			expect(result.error).toContain("not supported");
			expect(result.text).toBe("");
		});

		it("reads clipboard on macOS (pbpaste)", () => {
			// This test actually runs pbpaste — skip on non-macOS CI
			if (process.platform !== "darwin") return;
			const result = readClipboard("darwin");
			// Should not error even if clipboard is empty
			expect(result.error).toBeUndefined();
			expect(typeof result.text).toBe("string");
		});
	});

	describe("writeClipboard", () => {
		it("returns error for unsupported platform", () => {
			const result = writeClipboard("hello", "freebsd");
			expect(result.ok).toBe(false);
			expect(result.error).toContain("not supported");
		});

		it("writes and reads back on macOS", () => {
			if (process.platform !== "darwin") return;
			const testStr = `kota-clipboard-test-${Date.now()}`;
			const writeResult = writeClipboard(testStr, "darwin");
			expect(writeResult.ok).toBe(true);

			const readResult = readClipboard("darwin");
			expect(readResult.text).toBe(testStr);
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
			if (process.platform !== "darwin" && process.platform !== "linux") return;
			const result = await runClipboard({ action: "read" });
			// Should succeed (might be empty)
			expect(result.is_error).toBeUndefined();
		});

		it("writes clipboard via tool runner", async () => {
			if (process.platform !== "darwin") return;
			const text = `kota-run-test-${Date.now()}`;
			const result = await runClipboard({ action: "write", text });
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("chars to clipboard");
		});

		it("round-trips text through clipboard", async () => {
			if (process.platform !== "darwin") return;
			const text = "Hello from KOTA clipboard test! 🎉 Special chars: <>&\"'";
			await runClipboard({ action: "write", text });
			const readResult = await runClipboard({ action: "read" });
			expect(readResult.content).toBe(text);
		});
	});
});
