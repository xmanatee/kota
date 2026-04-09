import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const EXEC_TIMEOUT = 30_000;

export type ExtractorResult = { text: string; method: string };

export function extractText(
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
	const pdftotext = tryPdftotext(filePath, pages);
	if (pdftotext) return pdftotext;

	const pdfminer = tryPdfminer(filePath, pages);
	if (pdfminer) return pdfminer;

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
	if (process.platform === "darwin") {
		const result = tryTextutil(filePath);
		if (result) return result;
	}

	const pandoc = extractWithPandoc(filePath, "docx");
	if (pandoc) return pandoc;

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

export function extractWithPandoc(
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

export function parsePageRange(
	pages: string,
): { first: number; last: number } | null {
	if (!pages) return null;
	const match = pages.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
	if (!match) return null;
	const first = Number.parseInt(match[1], 10);
	const last = match[2] ? Number.parseInt(match[2], 10) : first;
	return { first, last };
}

export function installHint(ext: string): string {
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
