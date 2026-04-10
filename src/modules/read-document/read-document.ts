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

import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "../../core/tools/tool-result.js";
import {
	extractText,
	installHint,
} from "./read-document-extractors.js";

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

const DEFAULT_MAX_CHARS = 50_000;

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
