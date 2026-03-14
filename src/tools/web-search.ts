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

  // Try Brave Search API first if configured (JSON-based, no HTML scraping)
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const braveResults = await fetchBraveSearch(query, numResults, braveKey);
    if (braveResults && braveResults.length > 0) {
      return { content: formatResults(braveResults) };
    }
    // Brave returned no results — fall through to DDG
  }

  return fetchDuckDuckGo(query, numResults);
}

function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

// --- Brave Search API (JSON, reliable) ---

type BraveSearchResponse = {
  web?: { results?: Array<{ title: string; url: string; description?: string }> };
};

/** Parse Brave Search API JSON response into SearchResults. */
export function parseBraveResults(
  data: BraveSearchResponse,
  max: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const webResults = data.web?.results;
  if (!webResults) return results;
  for (const r of webResults) {
    if (results.length >= max) break;
    if (r.title && r.url) {
      results.push({ title: r.title, url: r.url, snippet: r.description || "" });
    }
  }
  return results;
}

async function fetchBraveSearch(
  query: string,
  numResults: number,
  apiKey: string,
): Promise<SearchResult[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url =
      `https://api.search.brave.com/res/v1/web/search` +
      `?q=${encodeURIComponent(query)}&count=${numResults}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as BraveSearchResponse;
    return parseBraveResults(data, numResults);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// --- DuckDuckGo HTML scraping (fallback) ---

async function fetchDuckDuckGo(
  query: string,
  numResults: number,
): Promise<ToolResult> {
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
      return { content: `Search failed: HTTP ${response.status}`, is_error: true };
    }

    const html = await response.text();

    if (isRateLimited(html)) {
      return {
        content:
          "Search rate-limited by DuckDuckGo (CAPTCHA challenge). " +
          "Wait a moment and retry, or use web_fetch with a direct URL.",
        is_error: true,
      };
    }

    const results = parseSearchResults(html, numResults);
    if (results.length === 0) {
      return { content: `No results found for: ${query}` };
    }
    return { content: formatResults(results) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      return { content: "Search timed out (15s)", is_error: true };
    }
    return { content: `Search error: ${msg}`, is_error: true };
  }
}

/** Detect DuckDuckGo rate limiting / CAPTCHA pages */
export function isRateLimited(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    (lower.includes("captcha") || lower.includes("please try again") ||
      lower.includes("automated requests")) &&
    !lower.includes("result__a")
  );
}

/** Parse DuckDuckGo HTML search results */
export function parseSearchResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  const resultBlockRegex =
    /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result|$)/gi;

  const blocks: string[] = [];
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = resultBlockRegex.exec(html)) !== null) {
    blocks.push(blockMatch[1]);
  }

  if (blocks.length === 0) {
    return parseFallback(html, max);
  }

  for (const block of blocks) {
    if (results.length >= max) break;

    const linkMatch = block.match(
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();
    const url = resolveRedirectUrl(rawUrl);
    if (!url || !title) continue;
    if (url.includes("duckduckgo.com")) continue;

    const snippetMatch = block.match(
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";

    results.push({ title, url, snippet });
  }

  return results;
}

function parseFallback(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

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

function resolveRedirectUrl(raw: string): string {
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
