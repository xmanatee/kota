import type Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import type { ToolResult } from "./index.js";

export const httpRequestTool: Anthropic.Tool = {
  name: "http_request",
  description:
    "Make an HTTP request. Supports all methods, custom headers, and request bodies. " +
    "Returns status, headers, and body. Use save_to for large responses or binary downloads. " +
    "For web pages use web_fetch instead.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The URL to request",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
        description: "HTTP method (default: GET)",
      },
      headers: {
        type: "object",
        description: "Request headers as key-value pairs (e.g. {\"Authorization\": \"Bearer token\", \"Content-Type\": \"application/json\"})",
        additionalProperties: { type: "string" },
      },
      body: {
        type: "string",
        description: "Request body (e.g. JSON string). Set Content-Type header appropriately.",
      },
      timeout_ms: {
        type: "number",
        description: "Request timeout in milliseconds (default: 30000)",
      },
      max_response_length: {
        type: "number",
        description: "Max response body length in chars (default: 20000)",
      },
      save_to: {
        type: "string",
        description:
          "Save response body to this file instead of returning inline. " +
          "Useful for large API responses or binary data.",
      },
    },
    required: ["url"],
  },
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RESPONSE = 20_000;

export async function runHttpRequest(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = input.url as string;
  const method = ((input.method as string) || "GET").toUpperCase();
  const headers = (input.headers as Record<string, string>) || {};
  const body = input.body as string | undefined;
  const timeoutMs = Math.min((input.timeout_ms as number) || DEFAULT_TIMEOUT, 120_000);
  const maxResponse = (input.max_response_length as number) || DEFAULT_MAX_RESPONSE;

  if (!url) {
    return { content: "Error: url is required", is_error: true };
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { content: "Error: url must start with http:// or https://", is_error: true };
  }

  if (!ALLOWED_METHODS.has(method)) {
    return { content: `Error: unsupported method "${method}"`, is_error: true };
  }

  if (body && (method === "GET" || method === "HEAD")) {
    return { content: `Error: ${method} requests cannot have a body`, is_error: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        "User-Agent": "KOTA/0.1",
        ...headers,
      },
      redirect: "follow",
    };

    if (body) {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeout);

    // Build response header summary (selected useful headers)
    const responseHeaders = formatResponseHeaders(response.headers);

    if (method === "HEAD") {
      return {
        content: formatResult(response.status, response.statusText, responseHeaders, "(HEAD — no body)"),
      };
    }

    const saveTo = input.save_to as string | undefined;
    const contentType = response.headers.get("content-type") || "";

    if (saveTo) {
      try {
        let size: number;
        if (isBinaryContentType(contentType)) {
          const buffer = Buffer.from(await response.arrayBuffer());
          writeFileSync(saveTo, buffer);
          size = buffer.length;
        } else {
          const raw = await response.text();
          writeFileSync(saveTo, raw, "utf-8");
          size = Buffer.byteLength(raw, "utf-8");
        }
        const result: ToolResult = {
          content: formatResult(response.status, response.statusText, responseHeaders,
            `[Saved to ${saveTo} (${formatBytes(size)})]`),
        };
        if (response.status >= 400) result.is_error = true;
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error saving response to ${saveTo}: ${msg}`, is_error: true };
      }
    }

    // Reject binary responses
    if (isBinaryContentType(contentType)) {
      const contentLength = response.headers.get("content-length");
      const size = contentLength ? ` (${formatBytes(Number(contentLength))})` : "";
      return {
        content: formatResult(
          response.status, response.statusText, responseHeaders,
          `[Binary response: ${contentType}${size} — use save_to to download to a file]`,
        ),
      };
    }

    const raw = await response.text();
    let bodyText = raw;

    // Pretty-print JSON for readability; use compact table for arrays of objects
    if (contentType.includes("json") || looksLikeJson(raw)) {
      try {
        const parsed = JSON.parse(raw);
        const table = formatTabularJson(parsed);
        bodyText = table ?? JSON.stringify(parsed, null, 2);
      } catch {
        // Not valid JSON despite content-type; use raw
      }
    }

    // Truncate large responses
    if (bodyText.length > maxResponse) {
      bodyText =
        bodyText.slice(0, maxResponse) +
        `\n\n[Truncated — ${bodyText.length} chars total, showing first ${maxResponse}. Use save_to to get the full response.]`;
    }

    const result: ToolResult = {
      content: formatResult(response.status, response.statusText, responseHeaders, bodyText),
    };
    if (response.status >= 400) {
      result.is_error = true;
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { content: `Error: request timed out (${Math.round(timeoutMs / 1000)}s)`, is_error: true };
    }
    return { content: `Request error: ${msg}`, is_error: true };
  }
}

function formatResult(status: number, statusText: string, headers: string, body: string): string {
  return `HTTP ${status} ${statusText}\n${headers}\n${body}`;
}

/** Format selected response headers as compact lines */
function formatResponseHeaders(headers: Headers): string {
  const interesting = [
    "content-type", "content-length", "location", "set-cookie",
    "x-request-id", "x-ratelimit-remaining", "x-ratelimit-limit",
    "retry-after", "www-authenticate", "allow",
  ];
  const lines: string[] = [];
  for (const name of interesting) {
    const value = headers.get(name);
    if (value) {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

function isBinaryContentType(ct: string): boolean {
  if (!ct) return false;
  return (
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct.includes("octet-stream") ||
    ct.includes("pdf") ||
    ct.includes("zip") ||
    ct.includes("gzip") ||
    ct.includes("tar")
  );
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 10;

/**
 * Format an array of objects as a compact markdown table.
 * Returns null if the data is not suitable for tabular display.
 */
export function formatTabularJson(data: unknown): string | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  // All elements must be plain objects with at least one key
  const rows = data as Record<string, unknown>[];
  if (!rows.every(r => r !== null && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length > 0)) {
    return null;
  }

  // Collect all unique keys in insertion order
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) keySet.add(k);
  }
  let cols = Array.from(keySet);
  const truncCols = cols.length > MAX_TABLE_COLS;
  if (truncCols) cols = cols.slice(0, MAX_TABLE_COLS);

  // Only tabulate if values are scalar (string, number, boolean, null)
  for (const row of rows) {
    for (const c of cols) {
      const v = row[c];
      if (v !== null && v !== undefined && typeof v === "object") return null;
    }
  }

  const displayRows = rows.slice(0, MAX_TABLE_ROWS);
  const truncRows = rows.length > MAX_TABLE_ROWS;

  // Compute column widths
  const widths = cols.map(c =>
    Math.max(c.length, ...displayRows.map(r => String(r[c] ?? "").length)),
  );

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const header = "| " + cols.map((c, i) => pad(c, widths[i])).join(" | ") + " |";
  const sep = "| " + widths.map(w => "-".repeat(w)).join(" | ") + " |";
  const body = displayRows.map(
    r => "| " + cols.map((c, i) => pad(String(r[c] ?? ""), widths[i])).join(" | ") + " |",
  );

  let result = [header, sep, ...body].join("\n");
  const notes: string[] = [];
  if (truncRows) notes.push(`showing ${MAX_TABLE_ROWS} of ${rows.length} rows`);
  if (truncCols) notes.push(`showing ${MAX_TABLE_COLS} of ${keySet.size} columns`);
  if (notes.length > 0) result += `\n[${notes.join("; ")}]`;
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
