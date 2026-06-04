import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { isAbortError } from "./http-request-utils.js";
import {
  fetchPublicWebAccessUrl,
  WebAccessTargetError,
} from "./private-network.js";
import {
  type BraveSearchResponse,
  formatResults,
  isRateLimited,
  parseBraveResults,
  parseSearchResults,
  type SearchResult,
} from "./web-search-helpers.js";

export const webSearchTool: KotaTool = {
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

type SearchProviderResult =
  | { status: "results"; results: SearchResult[] }
  | { status: "unavailable" }
  | { status: "blocked"; message: string };

export async function runWebSearch(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query = input.query as string;
  const numResults = Math.min(Math.max((input.num_results as number) || 5, 1), 10);

  if (!query || (typeof query === "string" && !query.trim())) {
    return { content: "Error: query is required", is_error: true };
  }

  // Try Brave Search API first if configured (JSON-based, no HTML scraping)
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const braveResults = await fetchBraveSearch(query, numResults, braveKey);
    if (braveResults.status === "blocked") {
      return { content: braveResults.message, is_error: true };
    }
    if (braveResults.status === "results") {
      return { content: formatResults(braveResults.results) };
    }
    // Brave returned no results — fall through to DDG
  }

  return fetchDuckDuckGo(query, numResults);
}

async function fetchBraveSearch(
  query: string,
  numResults: number,
  apiKey: string,
): Promise<SearchProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url =
      `https://api.search.brave.com/res/v1/web/search` +
      `?q=${encodeURIComponent(query)}&count=${numResults}`;
    const { response } = await fetchPublicWebAccessUrl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });
    if (!response.ok) return { status: "unavailable" };
    const data = (await response.json()) as BraveSearchResponse;
    const results = parseBraveResults(data, numResults);
    return results.length > 0
      ? { status: "results", results }
      : { status: "unavailable" };
  } catch (err) {
    if (err instanceof WebAccessTargetError) {
      return { status: "blocked", message: err.message };
    }
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDuckDuckGo(
  query: string,
  numResults: number,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { response } = await fetchPublicWebAccessUrl(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });

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
    if (isAbortError(err)) {
      return { content: "Search timed out (15s)", is_error: true };
    }
    if (err instanceof WebAccessTargetError) {
      return { content: err.message, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Search error: ${msg}`, is_error: true };
  } finally {
    clearTimeout(timeout);
  }
}
