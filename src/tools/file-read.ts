import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { extname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { CSV_EXTENSIONS, formatCsvMetadata } from "../data/csv-preview.js";
import { formatJsonPreview, JSON_EXTENSIONS } from "../data/json-preview.js";
import { recordRead } from "../file-tracker.js";
import { fileNotFoundError } from "../path-resolver.js";
import type { ToolResult, ToolResultBlock } from "./index.js";

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB — Claude API limit
const MAX_TEXT_SIZE = 50 * 1024 * 1024; // 50MB — prevent OOM on huge files

const DOCUMENT_FORMATS: Record<string, { type: string; hint: string }> = {
  ".xlsx": { type: "Excel spreadsheet", hint: "code_exec: `import pandas as pd; df = pd.read_excel('PATH')` (needs openpyxl)" },
  ".xls": { type: "Excel spreadsheet", hint: "code_exec: `import pandas as pd; df = pd.read_excel('PATH')` (needs xlrd)" },
  ".docx": { type: "Word document", hint: "code_exec with python-docx, or shell: `pandoc 'PATH' -t plain`" },
  ".pptx": { type: "PowerPoint", hint: "code_exec with python-pptx" },
  ".parquet": { type: "Parquet data", hint: "code_exec: `import pandas as pd; df = pd.read_parquet('PATH')`" },
  ".sqlite": { type: "SQLite database", hint: "code_exec: `import sqlite3; conn = sqlite3.connect('PATH')`" },
  ".db": { type: "SQLite database", hint: "code_exec: `import sqlite3; conn = sqlite3.connect('PATH')`" },
  ".zip": { type: "ZIP archive", hint: "shell: `unzip -l 'PATH'` (list) or `unzip 'PATH' -d out/`" },
  ".tar": { type: "TAR archive", hint: "shell: `tar -tf 'PATH'` (list) or `tar -xf 'PATH'`" },
  ".tgz": { type: "Compressed archive", hint: "shell: `tar -tzf 'PATH'` (list) or `tar -xzf 'PATH'`" },
  ".gz": { type: "Gzip file", hint: "shell: `gunzip 'PATH'` or `zcat 'PATH'`" },
};

function getDocumentFormat(filePath: string): { type: string; hint: string } | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tar.gz")) {
    return { type: "Compressed archive", hint: "shell: `tar -tzf 'PATH'` (list) or `tar -xzf 'PATH'`" };
  }
  if (lower.endsWith(".tar.bz2")) {
    return { type: "Compressed archive", hint: "shell: `tar -tjf 'PATH'` (list) or `tar -xjf 'PATH'`" };
  }
  const ext = extname(filePath).toLowerCase();
  return DOCUMENT_FORMATS[ext] ?? null;
}

function isBinaryFile(filePath: string): boolean {
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = readSync(fd, buf, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

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

  // Single statSync — all branches use stats.size, so one call eliminates
  // redundant stats and TOCTOU races between stat and read.
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return { content: `Error: permission denied reading ${filePath}`, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Error reading ${filePath}: ${msg}`, is_error: true };
  }

  if (stats.isDirectory()) {
    return {
      content: `Error: ${filePath} is a directory, not a file. Use glob or shell \`ls\` to list directory contents.`,
      is_error: true,
    };
  }

  const mediaType = isImageFile(filePath);
  if (mediaType) {
    return readImage(filePath, mediaType, stats.size);
  }

  if (isPdfFile(filePath)) {
    return readPdf(filePath, input, stats.size);
  }

  const docFormat = getDocumentFormat(filePath);
  if (docFormat) {
    const hint = docFormat.hint.replaceAll("PATH", filePath);
    return {
      content: `${docFormat.type} (${formatSize(stats.size)}): ${filePath}\n\n${hint}`,
    };
  }

  if (stats.size > 0) {
    try {
      if (isBinaryFile(filePath)) {
        return {
          content: `Binary file (${formatSize(stats.size)}): ${filePath}\nUse shell or code_exec to process this file.`,
        };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        return { content: `Error: permission denied reading ${filePath}`, is_error: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error reading ${filePath}: ${msg}`, is_error: true };
    }
  }

  return readText(filePath, input, stats.size);
}

function isPdfFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".pdf";
}

function readPdf(filePath: string, input: Record<string, unknown>, fileSize: number): ToolResult {
  if (fileSize === 0) {
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
    const limit = Math.max(1, (input.limit as number) || 2000);
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
    return { content: `[PDF: ${filePath}, ${formatSize(fileSize)}]\n\n${numbered}${info}` };
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

function readImage(filePath: string, mediaType: string, fileSize: number): ToolResult {
  if (fileSize > MAX_IMAGE_SIZE) {
    return {
      content: `Error: Image too large (${formatSize(fileSize)}). Maximum supported size is 20MB.`,
      is_error: true,
    };
  }
  if (fileSize === 0) {
    return { content: `Error: Image file is empty: ${filePath}`, is_error: true };
  }

  const data = readFileSync(filePath);
  const base64 = data.toString("base64");
  const description = `Image: ${filePath} (${formatSize(fileSize)})`;

  const blocks: ToolResultBlock[] = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: description },
  ];

  recordRead(filePath);
  return { content: description, blocks };
}

function readText(filePath: string, input: Record<string, unknown>, fileSize: number): ToolResult {
  if (fileSize > MAX_TEXT_SIZE) {
    return {
      content:
        `File too large (${formatSize(fileSize)}): ${filePath}\n` +
        `Maximum for direct reading is ${formatSize(MAX_TEXT_SIZE)}.\n` +
        `Use shell commands: \`head -n 100 '${filePath}'\`, \`tail -n 100 '${filePath}'\`, ` +
        `or \`sed -n '100,200p' '${filePath}'\` to read specific sections.`,
      is_error: true,
    };
  }

  const offset = Math.max(1, (input.offset as number) || 1);
  const limit = Math.max(1, (input.limit as number) || 2000);

  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n");
  const selected = lines.slice(offset - 1, offset - 1 + limit);

  const numbered = selected
    .map((line, i) => {
      const lineNum = String(offset + i).padStart(6, " ");
      return `${lineNum}\t${line}`;
    })
    .join("\n");

  const isTruncated = lines.length > offset - 1 + limit;
  let info = "";
  if (selected.length === 0 && lines.length > 0) {
    info = `\n\n[${lines.length} lines total — offset ${offset} is beyond end of file]`;
  } else if (isTruncated) {
    info = `\n\n[${formatSize(fileSize)} | ${lines.length} lines | showing ${offset}-${offset + selected.length - 1}]`;
    if (lines.length > 2 * limit) {
      info += `\nUse code_exec to process the full file programmatically.`;
    }
  }

  const ext = extname(filePath).toLowerCase();
  const csvDelimiter = CSV_EXTENSIONS[ext];
  let meta = "";
  if (csvDelimiter && lines.length > 0) {
    meta = formatCsvMetadata(lines, csvDelimiter);
  } else if (JSON_EXTENSIONS.has(ext)) {
    meta = formatJsonPreview(raw, filePath);
  }

  recordRead(filePath);
  return { content: meta + numbered + info };
}
export const registration = {
	tool: fileReadTool,
	runner: runFileRead,
	risk: "safe" as const,
	kind: "discovery" as const,
};
