import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "#core/tools/tool-result.js";
import { extractPage, formatMetadataHeader } from "./html-page-extract.js";

export const webFetchTool: Anthropic.Tool = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its content as clean Markdown. " +
    "Handles HTML (extracts content), JSON (pretty-prints with structure), " +
    "and plain text. Reports binary content types without reading garbled data.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
      max_length: {
        type: "number",
        description: "Maximum response length in characters (default: 20000)",
      },
      save_to: {
        type: "string",
        description:
          "Save response to this file path instead of returning content. " +
          "Works for both binary (PDF, images, ZIP) and text files. Returns file metadata.",
      },
    },
    required: ["url"],
  },
};

const BINARY_TYPE_PREFIX = /^(image|audio|video|font)\//;
const BINARY_SUBTYPE = /^application\/(pdf|zip|gzip|x-tar|x-7z-compressed|octet-stream|wasm|protobuf)/;

/** Returns true for content types that should not be read as text. */
export function isBinaryContentType(ct: string): boolean {
  const mime = ct.split(";")[0].trim().toLowerCase();
  if (mime === "image/svg+xml") return false;
  return BINARY_TYPE_PREFIX.test(mime) || BINARY_SUBTYPE.test(mime);
}

/** Pretty-print a JSON response with a structure hint header. */
export function formatJsonResponse(raw: string, maxLength: number): string {
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    let hint = "";
    if (Array.isArray(parsed)) {
      hint = `[JSON array — ${parsed.length} items]\n\n`;
    } else if (parsed !== null && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      const keyList = keys.slice(0, 10).join(", ");
      hint = `[JSON object — ${keys.length} keys: ${keyList}${keys.length > 10 ? ", ..." : ""}]\n\n`;
    }
    const text = hint + pretty;
    if (text.length > maxLength) {
      return text.slice(0, maxLength) +
        `\n\n[Truncated — ${text.length} chars total, showing first ${maxLength}]`;
    }
    return text;
  } catch {
    return raw.length > maxLength
      ? `${raw.slice(0, maxLength)}\n\n[Truncated — ${raw.length} chars total, showing first ${maxLength}]`
      : raw;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runWebFetch(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = input.url as string;
  const maxLength = Math.max(1, (input.max_length as number) || 20_000);

  if (!url) {
    return { content: "Error: url is required", is_error: true };
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { content: "Error: url must start with http:// or https://", is_error: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "KOTA/0.1 (AI coding agent)",
        "Accept": "text/html, text/plain, application/json, */*",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        content: `HTTP ${response.status} ${response.statusText}`,
        is_error: true,
      };
    }

    const contentType = response.headers.get("content-type") || "";

    // Download mode: save to file instead of returning content
    if (input.save_to) {
      const savePath = path.resolve(input.save_to as string);
      const mime = contentType.split(";")[0].trim();
      try {
        await mkdir(path.dirname(savePath), { recursive: true });
        if (isBinaryContentType(contentType)) {
          const buffer = await response.arrayBuffer();
          await writeFile(savePath, Buffer.from(buffer));
          return {
            content: `Downloaded ${mime} to ${savePath} (${formatBytes(buffer.byteLength)})`,
          };
        }
        const text = await response.text();
        await writeFile(savePath, text, "utf-8");
        const preview = text.slice(0, 500);
        return {
          content: `Saved to ${savePath} (${formatBytes(Buffer.byteLength(text))}, ${mime})\n\nPreview:\n${preview}${text.length > 500 ? "\n..." : ""}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error saving file: ${msg}`, is_error: true };
      }
    }

    // Binary content: report metadata instead of reading garbled text
    if (isBinaryContentType(contentType)) {
      const size = response.headers.get("content-length");
      const mime = contentType.split(";")[0].trim();
      const sizeInfo = size ? ` (${formatBytes(parseInt(size, 10))})` : "";
      await response.body?.cancel();
      return {
        content: `Binary content: ${mime}${sizeInfo}. ` +
          "Use web_fetch with save_to to download binary files.",
      };
    }

    const raw = await response.text();

    // JSON: pretty-print with structure hints
    if (contentType.includes("json")) {
      const text = formatJsonResponse(raw, maxLength);
      return { content: text || "(empty response)" };
    }

    let text: string;
    if (contentType.includes("html")) {
      const page = extractPage(raw);
      const header = formatMetadataHeader(page.metadata);
      text = header + page.content;
    } else {
      text = raw;
    }

    // Truncate to save tokens
    if (text.length > maxLength) {
      return {
        content: text.slice(0, maxLength) +
          `\n\n[Truncated — ${text.length} chars total, showing first ${maxLength}]`,
      };
    }

    return { content: text || "(empty response)" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError" ||
        err instanceof Error && err.name === "AbortError") {
      return { content: "Error: request timed out (30s)", is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Fetch error: ${msg}`, is_error: true };
  }
}
