import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  OUTBOUND_HTTP_PROFILES,
  OutboundHttpError,
  outboundHttp,
  outboundHttpPolicy,
} from "#core/outbound-http/index.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { resolveContainedPath } from "#core/tools/path-containment.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
  formatBytes,
  formatResponseHeaders,
  formatResult,
  formatTabularJson,
  formatTabularJsonPrefix,
  isBinaryContentType,
  looksLikeJson,
  safePositiveInt,
} from "./http-request-utils.js";
import {
  readResponseBytesWithLimit,
  readResponseTextPrefixWithLimit,
  readResponseTextWithLimit,
  WebAccessResponseBodyLimitError,
} from "./response-body-limit.js";

export const httpRequestTool: KotaTool = {
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
        description:
          'Request headers as key-value pairs (e.g. {"Authorization": "Bearer token", "Content-Type": "application/json"})',
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
          "Save response body to this scope file instead of returning inline. " +
          "Useful for large API responses or binary data.",
      },
    },
    required: ["url"],
  },
};

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RESPONSE = 20_000;

export async function runHttpRequest(input: Record<string, unknown>, context?: ToolRunnerContext): Promise<ToolResult> {
  const url = input.url as string;
  const method = ((input.method as string) || "GET").toUpperCase();
  const headers = (input.headers as Record<string, string>) || {};
  const body = input.body as string | undefined;
  const timeoutMs = safePositiveInt(input.timeout_ms, DEFAULT_TIMEOUT, 120_000);
  const maxResponse = safePositiveInt(input.max_response_length, DEFAULT_MAX_RESPONSE);
  const saveTo = typeof input.save_to === "string" && input.save_to.length > 0 ? input.save_to : undefined;
  const allowedRoot = context?.cwd ?? process.cwd();
  const savePath = saveTo ? resolveContainedPath(saveTo, allowedRoot, allowedRoot) : undefined;

  if (!url) {
    return { content: "Error: url is required", is_error: true };
  }

  if (!ALLOWED_METHODS.has(method)) {
    return { content: `Error: unsupported method "${method}"`, is_error: true };
  }

  if (body && (method === "GET" || method === "HEAD")) {
    return {
      content: `Error: ${method} requests cannot have a body`,
      is_error: true,
    };
  }

  if (savePath && !savePath.ok) {
    return {
      content: "Error: save_to must target a file inside the scope directory",
      is_error: true,
    };
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "User-Agent": "KOTA/0.1",
        ...headers,
      },
    };

    if (body) {
      fetchOptions.body = body;
    }

    let response: Response;
    let finalUrl = url;
    let redirected = false;
    const fetched = await outboundHttp.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "web-access.http-request",
      url,
      method: method as "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS",
      headers: fetchOptions.headers,
      ...(body ? { body } : {}),
      limits: {
        timeoutMs,
        responseBytes: savePath?.ok
          ? maxResponse
          : Math.max(maxResponse, outboundHttpPolicy("public-untrusted").responseBytes.default),
      },
    });
    response = fetched.response;
    finalUrl = fetched.url;
    redirected = fetched.redirected;

    // Build response header summary (selected useful headers)
    let responseHeaders = formatResponseHeaders(response.headers);

    // Show redirect info so users can debug endpoint issues
    if (redirected && finalUrl !== url) {
      responseHeaders = `[Redirected → ${finalUrl}]\n${responseHeaders}`;
    }

    if (method === "HEAD") {
      return {
        content: formatResult(response.status, response.statusText, responseHeaders, "(HEAD — no body)"),
      };
    }

    const contentType = response.headers.get("content-type") || "";

    if (savePath?.ok) {
      try {
        mkdirSync(dirname(savePath.path), { recursive: true });
        let size: number;
        if (isBinaryContentType(contentType)) {
          const bytes = await readResponseBytesWithLimit(response, maxResponse, "max_response_length");
          writeFileSync(savePath.path, bytes);
          size = bytes.byteLength;
        } else {
          const raw = await readResponseTextWithLimit(response, maxResponse, "max_response_length");
          writeFileSync(savePath.path, raw, "utf-8");
          size = Buffer.byteLength(raw, "utf-8");
        }
        const result: ToolResult = {
          content: formatResult(
            response.status,
            response.statusText,
            responseHeaders,
            `[Saved to ${savePath.path} (${formatBytes(size)})]`,
          ),
        };
        if (response.status >= 400) result.is_error = true;
        return result;
      } catch (err) {
        if (err instanceof WebAccessResponseBodyLimitError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: `Error saving response to ${savePath.path}: ${msg}`,
          is_error: true,
        };
      }
    }

    // Reject binary responses (no body read needed — clear timeout early)
    if (isBinaryContentType(contentType)) {
      const contentLength = response.headers.get("content-length");
      const size = contentLength ? ` (${formatBytes(Number(contentLength))})` : "";
      return {
        content: formatResult(
          response.status,
          response.statusText,
          responseHeaders,
          `[Binary response: ${contentType}${size} — use save_to to download to a file]`,
        ),
      };
    }

    const rawRead = await readResponseTextPrefixWithLimit(response, maxResponse, "max_response_length");
    const raw = rawRead.text;
    let bodyText = raw;

    // Pretty-print JSON for readability; use compact table for arrays of objects
    if (contentType.includes("json") || looksLikeJson(raw)) {
      try {
        const parsed = JSON.parse(raw);
        const table = formatTabularJson(parsed);
        bodyText = table ?? JSON.stringify(parsed, null, 2);
      } catch {
        bodyText = rawRead.truncated ? (formatTabularJsonPrefix(raw) ?? raw) : raw;
      }
    }

    // Truncate large responses
    if (bodyText.length > maxResponse || rawRead.truncated) {
      const truncation = rawRead.truncated
        ? `response exceeded ${maxResponse} bytes`
        : `${bodyText.length} chars total`;
      bodyText =
        bodyText.slice(0, maxResponse) +
        `\n\n[Truncated — ${truncation}, showing first ${maxResponse}. Use save_to to get the full response.]`;
    }

    const result: ToolResult = {
      content: formatResult(response.status, response.statusText, responseHeaders, bodyText),
    };
    if (response.status >= 400) {
      result.is_error = true;
    }
    return result;
  } catch (err) {
    if (err instanceof OutboundHttpError && err.failure.code === "timeout") {
      return {
        content: `Error: request timed out (${Math.round(timeoutMs / 1000)}s)`,
        is_error: true,
      };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "target-denied") {
      return { content: err.message, is_error: true };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "response-too-large") {
      return {
        content: `Error: max_response_length ${err.message}`,
        is_error: true,
      };
    }
    if (err instanceof WebAccessResponseBodyLimitError) {
      return { content: err.message, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Request error: ${msg}`, is_error: true };
  }
}
