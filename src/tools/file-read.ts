import { existsSync, statSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { fileNotFoundError } from "../path-resolver.js";
import {
  formatSize,
  getDocumentFormat,
  isBinaryFile,
  isImageFile,
  isPdfFile,
  readImage,
  readPdf,
  readText,
} from "./file-read-formats.js";
import type { ToolResult } from "./index.js";

export const fileReadTool: Anthropic.Tool = {
  name: "file_read",
  description:
    "Read a file with line numbers. Supports offset/limit for large files. " +
    "Reads images (PNG, JPEG, GIF, WebP) for visual analysis. " +
    "Reads PDFs by extracting text (requires pdftotext from poppler-utils). " +
    "Do NOT use to search for patterns across files (use grep) or to find files by name (use glob).",
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

export const registration = {
  tool: fileReadTool,
  runner: runFileRead,
  risk: "safe" as const,
  kind: "discovery" as const,
};
