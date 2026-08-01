import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { OUTBOUND_HTTP_PROFILES, OutboundHttpError, outboundHttp } from "#core/outbound-http/index.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { readResponseTextWithLimit, WebAccessResponseBodyLimitError } from "./response-body-limit.js";
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

const SEARCH_RESPONSE_MAX_BYTES = 1_000_000;

export async function runWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input.query as string;
  const numResults = Math.min(Math.max((input.num_results as number) || 5, 1), 10);

  if (!query || (typeof query === "string" && !query.trim())) {
    return { content: "Error: query is required", is_error: true };
  }

  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    const braveResults = await fetchBraveSearch(query, numResults, braveKey);
    if (braveResults.status === "blocked") {
      return { content: braveResults.message, is_error: true };
    }
    if (braveResults.status === "results") {
      return { content: formatResults(braveResults.results) };
    }
  }

  return fetchDuckDuckGo(query, numResults);
}

async function fetchBraveSearch(query: string, numResults: number, apiKey: string): Promise<SearchProviderResult> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`;
    const { response } = await outboundHttp.request({
      profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://api.search.brave.com"]),
      operation: "web-access.brave-search",
      url,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      limits: { timeoutMs: 15_000, responseBytes: SEARCH_RESPONSE_MAX_BYTES },
    });
    if (!response.ok) return { status: "unavailable" };
    const raw = await readResponseTextWithLimit(response, SEARCH_RESPONSE_MAX_BYTES, "search_response_limit");
    const data = JSON.parse(raw) as BraveSearchResponse;
    const results = parseBraveResults(data, numResults);
    return results.length > 0 ? { status: "results", results } : { status: "unavailable" };
  } catch (err) {
    if (err instanceof OutboundHttpError && err.failure.code === "target-denied") {
      return { status: "blocked", message: err.message };
    }
    return { status: "unavailable" };
  }
}

async function fetchDuckDuckGo(query: string, numResults: number): Promise<ToolResult> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { response } = await outboundHttp.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "web-access.duckduckgo-search",
      url: searchUrl,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      limits: { timeoutMs: 15_000, responseBytes: SEARCH_RESPONSE_MAX_BYTES },
    });

    if (!response.ok) {
      return {
        content: `Search failed: HTTP ${response.status}`,
        is_error: true,
      };
    }

    const html = await readResponseTextWithLimit(response, SEARCH_RESPONSE_MAX_BYTES, "search_response_limit");

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
    if (err instanceof OutboundHttpError && err.failure.code === "timeout") {
      return { content: "Search timed out (15s)", is_error: true };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "target-denied") {
      return { content: err.message, is_error: true };
    }
    if (err instanceof OutboundHttpError && err.failure.code === "response-too-large") {
      return { content: err.message, is_error: true };
    }
    if (err instanceof WebAccessResponseBodyLimitError) {
      return { content: err.message, is_error: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { content: `Search error: ${msg}`, is_error: true };
  }
}
