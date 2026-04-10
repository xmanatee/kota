import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
  formatBytes,
  formatResponseHeaders,
  formatResult,
  formatTabularJson,
  isAbortError,
  isBinaryContentType,
  looksLikeJson,
  safePositiveInt,
} from "./http-request-utils.js";

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
  const timeoutMs = safePositiveInt(input.timeout_ms, DEFAULT_TIMEOUT, 120_000);
  const maxResponse = safePositiveInt(input.max_response_length, DEFAULT_MAX_RESPONSE);

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

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
    // Keep timeout active — it covers body reads too, not just connection

    // Build response header summary (selected useful headers)
    let responseHeaders = formatResponseHeaders(response.headers);

    // Show redirect info so users can debug endpoint issues
    if (response.redirected && response.url && response.url !== url) {
      responseHeaders = `[Redirected → ${response.url}]\n${responseHeaders}`;
    }

    if (method === "HEAD") {
      clearTimeout(timeout);
      return {
        content: formatResult(response.status, response.statusText, responseHeaders, "(HEAD — no body)"),
      };
    }

    const saveTo = input.save_to as string | undefined;
    const contentType = response.headers.get("content-type") || "";

    if (saveTo) {
      try {
        mkdirSync(dirname(saveTo), { recursive: true });
        let size: number;
        if (isBinaryContentType(contentType)) {
          const buffer = Buffer.from(await response.arrayBuffer());
          clearTimeout(timeout);
          writeFileSync(saveTo, buffer);
          size = buffer.length;
        } else {
          const raw = await response.text();
          clearTimeout(timeout);
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
        clearTimeout(timeout);
        if (isAbortError(err)) throw err; // Let timeout bubble up
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error saving response to ${saveTo}: ${msg}`, is_error: true };
      }
    }

    // Reject binary responses (no body read needed — clear timeout early)
    if (isBinaryContentType(contentType)) {
      clearTimeout(timeout);
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
    clearTimeout(timeout);
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
    if (isAbortError(err)) {
      return { content: `Error: request timed out (${Math.round(timeoutMs / 1000)}s)`, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Request error: ${msg}`, is_error: true };
  }
}
