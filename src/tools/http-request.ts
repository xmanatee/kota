import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const httpRequestTool: Anthropic.Tool = {
  name: "http_request",
  description:
    "Make an HTTP request. Supports all methods, custom headers, and request bodies. " +
    "Returns status, headers, and body. For web pages use web_fetch instead.",
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

    const contentType = response.headers.get("content-type") || "";

    // Reject binary responses
    if (isBinaryContentType(contentType)) {
      const contentLength = response.headers.get("content-length");
      const size = contentLength ? ` (${formatBytes(Number(contentLength))})` : "";
      return {
        content: formatResult(
          response.status, response.statusText, responseHeaders,
          `[Binary response: ${contentType}${size} — use shell + curl to download]`,
        ),
      };
    }

    const raw = await response.text();
    let bodyText = raw;

    // Pretty-print JSON for readability
    if (contentType.includes("json") || looksLikeJson(raw)) {
      try {
        bodyText = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // Not valid JSON despite content-type; use raw
      }
    }

    // Truncate large responses
    if (bodyText.length > maxResponse) {
      bodyText =
        bodyText.slice(0, maxResponse) +
        `\n\n[Truncated — ${bodyText.length} chars total, showing first ${maxResponse}]`;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
