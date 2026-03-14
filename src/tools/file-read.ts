import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import type { ToolResult, ToolResultBlock } from "./index.js";
import { recordRead } from "../file-tracker.js";
import { fileNotFoundError } from "../path-resolver.js";

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB — Claude API limit

export const fileReadTool: Anthropic.Tool = {
  name: "file_read",
  description:
    "Read a file with line numbers. Supports offset/limit for large files. " +
    "Reads images (PNG, JPEG, GIF, WebP) for visual analysis. " +
    "Reads PDFs by extracting text (requires pdftotext from poppler-utils).",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file (absolute or relative to cwd)",
      },
      offset: {
        type: "number",
        description: "Start reading from this line number (1-based, default: 1). Ignored for images.",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to return (default: 2000). Ignored for images.",
      },
    },
    required: ["path"],
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isImageFile(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS[ext] ?? null;
}

export async function runFileRead(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const filePath = input.path as string;

  if (!filePath) {
    return { content: "Error: path is required", is_error: true };
  }

  if (!existsSync(filePath)) {
    return { content: fileNotFoundError(filePath), is_error: true };
  }

  const mediaType = isImageFile(filePath);
  if (mediaType) {
    return readImage(filePath, mediaType);
  }

  if (isPdfFile(filePath)) {
    return readPdf(filePath, input);
  }

  return readText(filePath, input);
}

function isPdfFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".pdf";
}

function readPdf(filePath: string, input: Record<string, unknown>): ToolResult {
  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { content: `Error: PDF file is empty: ${filePath}`, is_error: true };
  }

  try {
    const raw = execFileSync("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    }).toString("utf-8");

    if (!raw.trim()) {
      return {
        content: `PDF has no extractable text (may be scanned/image-based): ${filePath}\n` +
          `Try using code_exec with Python OCR (pytesseract) for scanned documents.`,
      };
    }

    const offset = Math.max(1, (input.offset as number) || 1);
    const limit = (input.limit as number) || 2000;
    const lines = raw.split("\n");
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = selected
      .map((line, i) => {
        const lineNum = String(offset + i).padStart(6, " ");
        return `${lineNum}\t${line}`;
      })
      .join("\n");
    const info =
      lines.length > offset - 1 + limit
        ? `\n\n[Showing lines ${offset}-${offset + selected.length - 1} of ${lines.length} total]`
        : "";

    recordRead(filePath);
    return { content: `[PDF: ${filePath}, ${formatSize(stats.size)}]\n\n${numbered}${info}` };
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return {
        content: `Cannot read PDF: pdftotext not installed.\n` +
          `Install: brew install poppler (macOS) or apt install poppler-utils (Linux).\n` +
          `Alternative: use code_exec with Python — import PyPDF2 or pdfplumber.`,
        is_error: true,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error reading PDF: ${msg}`, is_error: true };
  }
}

function readImage(filePath: string, mediaType: string): ToolResult {
  const stats = statSync(filePath);
  if (stats.size > MAX_IMAGE_SIZE) {
    return {
      content: `Error: Image too large (${formatSize(stats.size)}). Maximum supported size is 20MB.`,
      is_error: true,
    };
  }
  if (stats.size === 0) {
    return { content: `Error: Image file is empty: ${filePath}`, is_error: true };
  }

  const data = readFileSync(filePath);
  const base64 = data.toString("base64");
  const description = `Image: ${filePath} (${formatSize(stats.size)})`;

  const blocks: ToolResultBlock[] = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: description },
  ];

  recordRead(filePath);
  return { content: description, blocks };
}

function readText(filePath: string, input: Record<string, unknown>): ToolResult {
  const offset = Math.max(1, (input.offset as number) || 1);
  const limit = (input.limit as number) || 2000;

  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const selected = lines.slice(offset - 1, offset - 1 + limit);

  const numbered = selected
    .map((line, i) => {
      const lineNum = String(offset + i).padStart(6, " ");
      return `${lineNum}\t${line}`;
    })
    .join("\n");

  const info =
    lines.length > offset - 1 + limit
      ? `\n\n[Showing lines ${offset}-${offset + selected.length - 1} of ${lines.length} total]`
      : "";

  recordRead(filePath);
  return { content: numbered + info };
}
