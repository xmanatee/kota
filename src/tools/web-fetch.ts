import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const webFetchTool: Anthropic.Tool = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its text content. Use for reading documentation, " +
    "researching APIs, checking references, and accessing online resources. " +
    "HTML is stripped to extract readable text.",
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
      text = stripHtml(raw);
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

/** Strip HTML tags and extract readable text */
function stripHtml(html: string): string {
  let text = html;
  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|blockquote|pre)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = decodeEntities(text);
  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
  "&laquo;": "«", "&raquo;": "»", "&copy;": "©", "&reg;": "®",
};

function decodeEntities(text: string): string {
  let result = text;
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    result = result.replaceAll(entity, char);
  }
  // Handle numeric entities: &#123; and &#x1F;
  result = result.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
  return result;
}
