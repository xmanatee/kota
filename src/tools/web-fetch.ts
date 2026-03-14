import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";
import { extractContent } from "../html-extract.js";

export const webFetchTool: Anthropic.Tool = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its content in Markdown format. Removes " +
    "boilerplate (navigation, headers, footers, sidebars) and preserves " +
    "structure (headings, code blocks, lists, links). Use for reading " +
    "documentation, researching APIs, and accessing online resources.",
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
    },
    required: ["url"],
  },
};

export async function runWebFetch(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const url = input.url as string;
  const maxLength = (input.max_length as number) || 20_000;

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
    const raw = await response.text();

    let text: string;
    if (contentType.includes("html")) {
      text = extractContent(raw);
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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { content: "Error: request timed out (30s)", is_error: true };
    }
    return { content: `Fetch error: ${msg}`, is_error: true };
  }
}

