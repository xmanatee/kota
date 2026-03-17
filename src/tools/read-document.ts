/**
 * Read Document tool — extract text from PDFs, DOCX, RTF, and other
 * document formats using available system tools. Zero npm dependencies.
 *
 * Platform support:
 *   PDF:  pdftotext (poppler), then python3 pdfminer fallback
 *   DOCX: textutil (macOS built-in), pandoc, python3-docx fallback
 *   RTF:  textutil (macOS built-in), pandoc
 *   ODT:  pandoc
 *   Other: pandoc as a universal fallback
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const readDocumentTool: Anthropic.Tool = {
	name: "read_document",
	description:
		"Extract text content from document files (PDF, DOCX, RTF, ODT). " +
		"Uses system tools (pdftotext, textutil, pandoc) — no external dependencies needed. " +
		"Returns extracted plain text. Use for: research papers, reports, contracts, manuals, " +
		"any document that file_read can't handle as plain text.",
	input_schema: {
		type: "object" as const,
		properties: {
			path: {
				type: "string",
				description: "Path to the document file",
			},
			pages: {
				type: "string",
				description:
					'Page range for PDFs (e.g. "1-5", "3", "10-20"). Default: all pages.',
			},
			max_chars: {
				type: "number",
				description:
					"Maximum characters to return (default: 50000). Truncates with a notice if exceeded.",
			},
		},
		required: ["path"],
	},
};

const EXEC_TIMEOUT = 30_000;
const DEFAULT_MAX_CHARS = 50_000;

type ExtractorResult = { text: string; method: string };

export async function runReadDocument(
	input: Record<string, unknown>,
): Promise<ToolResult> {
	const rawPath = input.path as string;
	if (!rawPath) {
		return { content: "Error: path is required", is_error: true };
	}

	const filePath = resolve(rawPath);
	if (!existsSync(filePath)) {
		return { content: `Error: file not found: ${filePath}`, is_error: true };
	}

	const ext = extname(filePath).toLowerCase();
	const maxChars = (input.max_chars as number) || DEFAULT_MAX_CHARS;
	const pages = (input.pages as string) || undefined;

	try {
		const result = extractText(filePath, ext, pages);
		if (!result) {
			return {
				content: `No extractor available for ${ext} files. ${installHint(ext)}`,
				is_error: true,
			};
		}

		let text = result.text.trim();
		let truncated = false;
		if (text.length > maxChars) {
			text = text.slice(0, maxChars);
			truncated = true;
		}

		if (!text) {
			return {
				content: `Document extracted (via ${result.method}) but contains no text. The file may be image-based — try screenshot + OCR instead.`,
			};
		}

		const header = `[Extracted via ${result.method}, ${text.length} chars${truncated ? " (truncated)" : ""}]`;
		return { content: `${header}\n\n${text}` };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: `Error extracting text from ${ext}: ${msg}. ${installHint(ext)}`,
			is_error: true,
		};
	}
}

function extractText(
	filePath: string,
	ext: string,
	pages?: string,
): ExtractorResult | null {
	switch (ext) {
		case ".pdf":
			return extractPdf(filePath, pages);
		case ".docx":
			return extractDocx(filePath);
		case ".rtf":
			return extractRtf(filePath);
		case ".odt":
			return extractWithPandoc(filePath, "odt");
		case ".doc":
			return extractWithPandoc(filePath, "doc");
		case ".epub":
			return extractWithPandoc(filePath, "epub");
		case ".html":
		case ".htm":
			return extractHtml(filePath);
		default:
			return extractWithPandoc(filePath, ext.slice(1));
	}
}

// ─── PDF extraction ────────────────────────────────────────────────────

function extractPdf(
	filePath: string,
	pages?: string,
): ExtractorResult | null {
	// Try pdftotext (poppler) first — highest quality
	const pdftotext = tryPdftotext(filePath, pages);
	if (pdftotext) return pdftotext;

	// Try python3 with pdfminer.six
	const pdfminer = tryPdfminer(filePath, pages);
	if (pdfminer) return pdfminer;

	// Try python3 with PyPDF2
	const pypdf = tryPyPdf(filePath, pages);
	if (pypdf) return pypdf;

	return null;
}

function tryPdftotext(
	filePath: string,
	pages?: string,
): ExtractorResult | null {
	try {
		const args: string[] = [];
		if (pages) {
			const range = parsePageRange(pages);
			if (range) {
				args.push("-f", String(range.first), "-l", String(range.last));
			}
		}
		args.push(filePath, "-");
		const text = execFileSync("pdftotext", args, {
			timeout: EXEC_TIMEOUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { text, method: "pdftotext" };
	} catch {
		return null;
	}
}

function tryPdfminer(
	filePath: string,
	pages?: string,
): ExtractorResult | null {
	try {
		const pageFilter = pages
			? `page_numbers=set(range(${parsePageRange(pages)?.first ?? 1}-1, ${parsePageRange(pages)?.last ?? 9999}))`
			: "";
		const script = [
			"from pdfminer.high_level import extract_text",
			pageFilter
				? `text = extract_text(${JSON.stringify(filePath)}, ${pageFilter})`
				: `text = extract_text(${JSON.stringify(filePath)})`,
			"print(text)",
		].join("; ");
		const text = execFileSync("python3", ["-c", script], {
			timeout: EXEC_TIMEOUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { text, method: "pdfminer" };
	} catch {
		return null;
	}
}

function tryPyPdf(filePath: string, pages?: string): ExtractorResult | null {
	try {
		const range = parsePageRange(pages ?? "");
		const script = [
			"from PyPDF2 import PdfReader",
			`r = PdfReader(${JSON.stringify(filePath)})`,
			range
				? `pages = range(${range.first - 1}, min(${range.last}, len(r.pages)))`
				: "pages = range(len(r.pages))",
			'print("\\n".join(r.pages[i].extract_text() or "" for i in pages))',
		].join("\n");
		const text = execFileSync("python3", ["-c", script], {
			timeout: EXEC_TIMEOUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { text, method: "PyPDF2" };
	} catch {
		return null;
	}
}

// ─── DOCX extraction ──────────────────────────────────────────────────

function extractDocx(filePath: string): ExtractorResult | null {
	// macOS: textutil is built-in
	if (process.platform === "darwin") {
		const result = tryTextutil(filePath);
		if (result) return result;
	}

	// pandoc (cross-platform)
	const pandoc = extractWithPandoc(filePath, "docx");
	if (pandoc) return pandoc;

	// python3-docx fallback
	return tryPythonDocx(filePath);
}

function tryTextutil(filePath: string): ExtractorResult | null {
	try {
		const text = execFileSync(
			"textutil",
			["-convert", "txt", "-stdout", filePath],
			{
				timeout: EXEC_TIMEOUT,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		return { text, method: "textutil" };
	} catch {
		return null;
	}
}

function tryPythonDocx(filePath: string): ExtractorResult | null {
	try {
		const script = [
			"from docx import Document",
			`d = Document(${JSON.stringify(filePath)})`,
			'print("\\n".join(p.text for p in d.paragraphs))',
		].join("; ");
		const text = execFileSync("python3", ["-c", script], {
			timeout: EXEC_TIMEOUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { text, method: "python-docx" };
	} catch {
		return null;
	}
}

// ─── RTF extraction ───────────────────────────────────────────────────

function extractRtf(filePath: string): ExtractorResult | null {
	if (process.platform === "darwin") {
		const result = tryTextutil(filePath);
		if (result) return result;
	}
	return extractWithPandoc(filePath, "rtf");
}

// ─── HTML extraction (local files) ────────────────────────────────────

function extractHtml(filePath: string): ExtractorResult | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
		return { text, method: "html-strip" };
	} catch {
		return null;
	}
}

// ─── Pandoc (universal fallback) ──────────────────────────────────────

function extractWithPandoc(
	filePath: string,
	format: string,
): ExtractorResult | null {
	try {
		const args = ["-f", format, "-t", "plain", "--wrap=none", filePath];
		const text = execFileSync("pandoc", args, {
			timeout: EXEC_TIMEOUT,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { text, method: "pandoc" };
	} catch {
		return null;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parsePageRange(
	pages: string,
): { first: number; last: number } | null {
	if (!pages) return null;
	const match = pages.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
	if (!match) return null;
	const first = Number.parseInt(match[1], 10);
	const last = match[2] ? Number.parseInt(match[2], 10) : first;
	return { first, last };
}

function installHint(ext: string): string {
	switch (ext) {
		case ".pdf":
			return "Install poppler: brew install poppler (macOS) or apt install poppler-utils (Linux).";
		case ".docx":
		case ".doc":
		case ".rtf":
		case ".odt":
		case ".epub":
			return "Install pandoc: brew install pandoc (macOS) or apt install pandoc (Linux).";
		default:
			return "Install pandoc for broad format support: brew install pandoc.";
	}
}
export const registration = {
	tool: readDocumentTool,
	runner: runReadDocument,
	risk: "safe" as const,
};
