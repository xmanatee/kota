import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./index.js";

export const webSearchTool: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the web. Returns titles, URLs, and snippets for the top results. " +
    "Use web_fetch to read full pages from URLs returned.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      num_results: {
        type: "number",
        description: "Number of results to return (default: 5, max: 10)",
      },
    },
    required: ["query"],
  },
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export async function runWebSearch(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query = input.query as string;
  const numResults = Math.min(Math.max((input.num_results as number) || 5, 1), 10);

  if (!query) {
    return { content: "Error: query is required", is_error: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        content: `Search failed: HTTP ${response.status}`,
        is_error: true,
      };
    }

    const html = await response.text();
    const results = parseSearchResults(html, numResults);

    if (results.length === 0) {
      return { content: `No results found for: ${query}` };
    }

    const formatted = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");

    return { content: formatted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { content: "Search timed out (15s)", is_error: true };
    }
    return { content: `Search error: ${msg}`, is_error: true };
  }
}

/** Parse DuckDuckGo HTML search results */
function parseSearchResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML wraps each result in a div.result
  // Title/link: <a class="result__a" href="...">Title</a>
  // Snippet: <a class="result__snippet" ...>Snippet text</a>
  const resultBlockRegex =
    /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;

  const blocks: string[] = [];
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = resultBlockRegex.exec(html)) !== null) {
    blocks.push(blockMatch[1]);
  }

  // If block parsing fails, fall back to extracting links and snippets globally
  if (blocks.length === 0) {
    return parseFallback(html, max);
  }

  for (const block of blocks) {
    if (results.length >= max) break;

    // Extract link and title
    const linkMatch = block.match(
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();
    const url = resolveRedirectUrl(rawUrl);
    if (!url || !title) continue;

    // Skip DuckDuckGo internal links
    if (url.includes("duckduckgo.com")) continue;

    // Extract snippet
    const snippetMatch = block.match(
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";

    results.push({ title, url, snippet });
  }

  return results;
}

/** Fallback parser: extract result links and snippets directly */
function parseFallback(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match any anchor with result__a class
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: { url: string; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = resolveRedirectUrl(match[1]);
    const title = stripTags(match[2]).trim();
    if (url && title && !url.includes("duckduckgo.com")) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripTags(match[1]).trim());
  }

  for (let i = 0; i < Math.min(links.length, max); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  return results;
}

/** Decode DuckDuckGo redirect URLs to get the actual destination */
function resolveRedirectUrl(raw: string): string {
  // DuckDuckGo wraps URLs: //duckduckgo.com/l/?uddg=ENCODED_URL&rut=...
  if (raw.includes("uddg=")) {
    const uddgMatch = raw.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
  }
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http")) return raw;
  return "";
}

/** Strip HTML tags from a string */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
