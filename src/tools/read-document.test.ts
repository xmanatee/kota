import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReadDocument } from "./read-document.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const mockExists = existsSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;

describe("runReadDocument", () => {
	const originalPlatform = process.platform;

	function setPlatform(p: string) {
		Object.defineProperty(process, "platform", { value: p, writable: true });
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockExists.mockReturnValue(true);
	});

	afterEach(() => {
		setPlatform(originalPlatform);
	});

	// --- Validation ---

	it("returns error when path is missing", async () => {
		const result = await runReadDocument({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("path is required");
	});

	it("returns error when file does not exist", async () => {
		mockExists.mockReturnValue(false);
		const result = await runReadDocument({ path: "/tmp/missing.pdf" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("file not found");
	});

	// --- PDF extraction ---

	it("extracts PDF via pdftotext", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return "Hello from PDF";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Hello from PDF");
		expect(result.content).toContain("pdftotext");
	});

	it("falls back to pdfminer when pdftotext unavailable", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") throw new Error("not found");
			if (cmd === "python3") return "Mined PDF text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Mined PDF text");
	});

	it("passes page range to pdftotext", async () => {
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "pdftotext") {
				expect(args).toContain("-f");
				expect(args).toContain("3");
				expect(args).toContain("-l");
				expect(args).toContain("7");
				return "Pages 3-7";
			}
			throw new Error("unexpected");
		});

		const result = await runReadDocument({
			path: "/tmp/test.pdf",
			pages: "3-7",
		});
		expect(result.content).toContain("Pages 3-7");
	});

	it("handles single page number", async () => {
		mockExec.mockImplementation((cmd: string, args: string[]) => {
			if (cmd === "pdftotext") {
				expect(args).toContain("-f");
				expect(args).toContain("5");
				expect(args).toContain("-l");
				expect(args).toContain("5");
				return "Page 5";
			}
			throw new Error("unexpected");
		});

		const result = await runReadDocument({
			path: "/tmp/test.pdf",
			pages: "5",
		});
		expect(result.content).toContain("Page 5");
	});

	it("returns error when no PDF extractor available", async () => {
		mockExec.mockImplementation(() => {
			throw new Error("not found");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("No extractor available");
		expect(result.content).toContain("poppler");
	});

	// --- DOCX extraction ---

	it("extracts DOCX via textutil on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "textutil") return "Word document text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.docx" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Word document text");
		expect(result.content).toContain("textutil");
	});

	it("extracts DOCX via pandoc on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") return "Pandoc extracted text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.docx" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Pandoc extracted text");
		expect(result.content).toContain("pandoc");
	});

	it("falls back to python-docx when pandoc unavailable", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") throw new Error("not found");
			if (cmd === "python3") return "Python docx text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.docx" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Python docx text");
	});

	// --- RTF extraction ---

	it("extracts RTF via textutil on macOS", async () => {
		setPlatform("darwin");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "textutil") return "RTF content";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.rtf" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("RTF content");
	});

	it("extracts RTF via pandoc on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") return "Pandoc RTF text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.rtf" });
		expect(result.content).toContain("Pandoc RTF text");
	});

	// --- ODT extraction ---

	it("extracts ODT via pandoc", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") return "ODT content";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.odt" });
		expect(result.content).toContain("ODT content");
	});

	// --- HTML extraction ---

	it("extracts text from local HTML files", async () => {
		mockRead.mockReturnValue(
			"<html><body><p>Hello</p> <b>World</b></body></html>",
		);

		const result = await runReadDocument({ path: "/tmp/test.html" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Hello");
		expect(result.content).toContain("World");
		expect(result.content).toContain("html-strip");
	});

	// --- Truncation ---

	it("truncates output exceeding max_chars", async () => {
		const longText = "A".repeat(100);
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return longText;
			throw new Error("unexpected");
		});

		const result = await runReadDocument({
			path: "/tmp/test.pdf",
			max_chars: 50,
		});
		expect(result.content).toContain("truncated");
		expect(result.content).toContain("50 chars");
	});

	it("does not truncate when under max_chars", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return "Short text";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.content).not.toContain("truncated");
	});

	// --- Empty content ---

	it("reports when document has no text", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return "   ";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("no text");
		expect(result.content).toContain("image-based");
	});

	// --- EPUB extraction ---

	it("extracts EPUB via pandoc", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") return "Book content";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/book.epub" });
		expect(result.content).toContain("Book content");
	});

	// --- Install hints ---

	it("shows poppler install hint for PDF failures", async () => {
		mockExec.mockImplementation(() => {
			throw new Error("not found");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.content).toContain("poppler");
	});

	it("shows pandoc install hint for DOCX failures on Linux", async () => {
		setPlatform("linux");
		mockExec.mockImplementation(() => {
			throw new Error("not found");
		});

		const result = await runReadDocument({ path: "/tmp/test.docx" });
		expect(result.content).toContain("pandoc");
	});

	// --- Header format ---

	it("includes extraction method and char count in header", async () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return "Some PDF content here";
			throw new Error("unexpected");
		});

		const result = await runReadDocument({ path: "/tmp/test.pdf" });
		expect(result.content).toMatch(
			/\[Extracted via pdftotext, \d+ chars\]/,
		);
	});
});
