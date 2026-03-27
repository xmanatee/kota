import { decodeEntities } from "../data/html-extract.js";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type BraveSearchResponse = {
  web?: { results?: Array<{ title: string; url: string; description?: string }> };
};

export function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

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

  return results.length > 0 ? results : parseFallback(html, max);
}

function parseFallback(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];

  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: { url: string; title: string; pos: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = resolveRedirectUrl(match[1]);
    const title = stripTags(match[2]).trim();
    if (url && title && !url.includes("duckduckgo.com")) {
      links.push({ url, title, pos: match.index });
    }
  }

  const snippets: { text: string; pos: number }[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push({ text: stripTags(match[1]).trim(), pos: match.index });
  }

  let snippetIdx = 0;
  for (let i = 0; i < Math.min(links.length, max); i++) {
    while (snippetIdx < snippets.length && snippets[snippetIdx].pos < links[i].pos) {
      snippetIdx++;
    }
    const nextLinkPos = i + 1 < links.length ? links[i + 1].pos : Infinity;
    const snippet =
      snippetIdx < snippets.length && snippets[snippetIdx].pos < nextLinkPos
        ? snippets[snippetIdx++].text
        : "";

    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet,
    });
  }

  return results;
}

function resolveRedirectUrl(raw: string): string {
  if (raw.includes("uddg=")) {
    const uddgMatch = raw.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        return decodeURIComponent(uddgMatch[1]);
      } catch {
        return uddgMatch[1];
      }
    }
  }
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http")) return raw;
  return "";
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
