import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	extractText,
	installHint,
	parsePageRange,
} from "./read-document-extractors.js";

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as ReturnType<typeof vi.fn>;

describe("parsePageRange", () => {
	it("parses single page", () => {
		expect(parsePageRange("5")).toEqual({ first: 5, last: 5 });
	});

	it("parses range", () => {
		expect(parsePageRange("3-7")).toEqual({ first: 3, last: 7 });
	});

	it("returns null for empty string", () => {
		expect(parsePageRange("")).toBeNull();
	});

	it("returns null for invalid format", () => {
		expect(parsePageRange("abc")).toBeNull();
	});
});

describe("installHint", () => {
	it("mentions poppler for PDF", () => {
		expect(installHint(".pdf")).toContain("poppler");
	});

	it("mentions pandoc for DOCX", () => {
		expect(installHint(".docx")).toContain("pandoc");
	});

	it("mentions pandoc for unknown format", () => {
		expect(installHint(".xyz")).toContain("pandoc");
	});
});

describe("extractText", () => {
	it("extracts PDF via pdftotext", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pdftotext") return "PDF text";
			throw new Error("unexpected");
		});
		const result = extractText("/tmp/test.pdf", ".pdf");
		expect(result?.text).toBe("PDF text");
		expect(result?.method).toBe("pdftotext");
	});

	it("extracts HTML via html-strip", () => {
		mockRead.mockReturnValue("<p>Hello</p>");
		const result = extractText("/tmp/test.html", ".html");
		expect(result?.text).toContain("Hello");
		expect(result?.method).toBe("html-strip");
	});

	it("uses pandoc for ODT", () => {
		mockExec.mockImplementation((cmd: string) => {
			if (cmd === "pandoc") return "ODT content";
			throw new Error("unexpected");
		});
		const result = extractText("/tmp/test.odt", ".odt");
		expect(result?.method).toBe("pandoc");
	});

	it("returns null when no extractor succeeds for PDF", () => {
		mockExec.mockImplementation(() => {
			throw new Error("not found");
		});
		const result = extractText("/tmp/test.pdf", ".pdf");
		expect(result).toBeNull();
	});
});
