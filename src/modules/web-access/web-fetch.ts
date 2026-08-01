import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  OUTBOUND_HTTP_PROFILES,
  OutboundHttpError,
  outboundHttp,
  outboundHttpPolicy,
} from "#core/outbound-http/index.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { resolveProjectPath } from "#core/tools/project-path-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { extractPage, formatMetadataHeader } from "./html-page-extract.js";
import { safePositiveInt } from "./http-request-utils.js";
import {
  readResponseBytesWithLimit,
  readResponseTextPrefixWithLimit,
  readResponseTextWithLimit,
  WebAccessResponseBodyLimitError,
} from "./response-body-limit.js";

export const webFetchTool: KotaTool = {
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
          "Save response to this project file path instead of returning content. " +
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
      return `${text.slice(0, maxLength)}\n\n[Truncated — ${text.length} chars total, showing first ${maxLength}]`;
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

export async function runWebFetch(input: Record<string, unknown>, context?: ToolRunnerContext): Promise<ToolResult> {
  const url = input.url as string;
  const maxLength = safePositiveInt(input.max_length, 20_000);
  const saveTo = typeof input.save_to === "string" && input.save_to.length > 0 ? input.save_to : undefined;
  const projectDirectory = context?.cwd ?? process.cwd();
  const savePath = saveTo ? resolveProjectPath(saveTo, projectDirectory, projectDirectory) : undefined;

  if (!url) {
    return { content: "Error: url is required", is_error: true };
  }

  if (savePath && !savePath.ok) {
    return {
      content: "Error: save_to must target a file inside the project directory",
      is_error: true,
    };
  }

  try {
    const { response } = await outboundHttp.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "web-access.web-fetch",
      url,
      headers: {
        "User-Agent": "KOTA/0.1 (AI coding agent)",
        Accept: "text/html, text/plain, application/json, */*",
      },
      limits: {
        timeoutMs: 30_000,
        responseBytes: savePath?.ok
          ? maxLength
          : Math.max(maxLength, outboundHttpPolicy("public-untrusted").responseBytes.default),
      },
    });

    if (!response.ok) {
      return {
        content: `HTTP ${response.status} ${response.statusText}`,
        is_error: true,
      };
    }

    const contentType = response.headers.get("content-type") || "";

    // Download mode: save to file instead of returning content
    if (savePath?.ok) {
      const mime = contentType.split(";")[0].trim();
      try {
        await mkdir(dirname(savePath.path), { recursive: true });
        if (isBinaryContentType(contentType)) {
          const buffer = await readResponseBytesWithLimit(response, maxLength, "max_length");
          await writeFile(savePath.path, buffer);
          return {
            content: `Downloaded ${mime} to ${savePath.path} (${formatBytes(buffer.byteLength)})`,
          };
        }
        const text = await readResponseTextWithLimit(response, maxLength, "max_length");
        await writeFile(savePath.path, text, "utf-8");
        const preview = text.slice(0, 500);
        return {
          content: `Saved to ${savePath.path} (${formatBytes(Buffer.byteLength(text))}, ${mime})\n\nPreview:\n${preview}${text.length > 500 ? "\n..." : ""}`,
        };
      } catch (err) {
        if (err instanceof WebAccessResponseBodyLimitError) throw err;
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
        content: `Binary content: ${mime}${sizeInfo}. Use web_fetch with save_to to download binary files.`,
      };
    }

    const rawRead = await readResponseTextPrefixWithLimit(response, maxLength, "max_length");
    const raw = rawRead.text;

    // JSON: pretty-print with structure hints
    if (contentType.includes("json")) {
      let text = formatJsonResponse(raw, maxLength);
      if (rawRead.truncated && !text.includes("[Truncated")) {
        text += `\n\n[Truncated — response exceeded ${maxLength} bytes, showing first ${raw.length} chars]`;
      }
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
    if (text.length > maxLength || rawRead.truncated) {
      const visible = text.slice(0, maxLength);
      const truncation = rawRead.truncated
        ? `response exceeded ${maxLength} bytes, showing first ${visible.length} chars`
        : `${text.length} chars total, showing first ${maxLength}`;
      return {
        content: `${visible}\n\n[Truncated — ${truncation}]`,
      };
    }

    return { content: text || "(empty response)" };
  } catch (err) {
    if (err instanceof OutboundHttpError && err.failure.code === "timeout") {
      return { content: "Error: request timed out (30s)", is_error: true };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "target-denied") {
      return { content: err.message, is_error: true };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "response-too-large") {
      return { content: `Error: max_length ${err.message}`, is_error: true };
    }
    if (err instanceof WebAccessResponseBodyLimitError) {
      return { content: err.message, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Fetch error: ${msg}`, is_error: true };
  }
}
