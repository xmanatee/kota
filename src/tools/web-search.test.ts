import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRateLimited, parseBraveResults, parseSearchResults, runWebSearch } from "./web-search.js";

describe("isRateLimited", () => {
  it("detects CAPTCHA pages", () => {
    const html = '<html><body><div class="captcha">Please solve this captcha</div></body></html>';
    expect(isRateLimited(html)).toBe(true);
  });

  it("detects 'please try again' pages", () => {
    const html = "<html><body><p>Please try again later.</p></body></html>";
    expect(isRateLimited(html)).toBe(true);
  });

  it("detects automated requests block", () => {
    const html =
      "<html><body><p>We detected automated requests from your network.</p></body></html>";
    expect(isRateLimited(html)).toBe(true);
  });

  it("returns false for normal results page with captcha mention in content", () => {
    const html =
      '<div class="result"><a class="result__a" href="https://example.com">How CAPTCHAs Work</a>' +
      '<a class="result__snippet">Learn about captcha technology</a></div>';
    expect(isRateLimited(html)).toBe(false);
  });

  it("returns false for normal search results", () => {
    const html =
      '<div class="result"><a class="result__a" href="https://example.com">Title</a>' +
      '<a class="result__snippet">Snippet text</a></div>';
    expect(isRateLimited(html)).toBe(false);
  });

  it("returns false for empty HTML", () => {
    expect(isRateLimited("")).toBe(false);
  });
});

describe("parseSearchResults", () => {
  const makeResultHtml = (results: { url: string; title: string; snippet: string }[]) => {
    return results
      .map(
        (r) =>
          `<div class="result">` +
          `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&rut=abc">${r.title}</a>` +
          `<a class="result__snippet">${r.snippet}</a>` +
          `</div>`,
      )
      .join("\n");
  };

  it("parses results with DDG redirect URLs", () => {
    const html = makeResultHtml([
      { url: "https://example.com/page1", title: "Page One", snippet: "First result" },
      { url: "https://example.com/page2", title: "Page Two", snippet: "Second result" },
    ]);
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Page One");
    expect(results[0].url).toBe("https://example.com/page1");
    expect(results[0].snippet).toBe("First result");
  });

  it("respects max limit", () => {
    const html = makeResultHtml([
      { url: "https://a.com", title: "A", snippet: "a" },
      { url: "https://b.com", title: "B", snippet: "b" },
      { url: "https://c.com", title: "C", snippet: "c" },
    ]);
    const results = parseSearchResults(html, 2);
    expect(results).toHaveLength(2);
  });

  it("returns empty for HTML with no results", () => {
    const html = "<html><body><p>Nothing here</p></body></html>";
    expect(parseSearchResults(html, 5)).toHaveLength(0);
  });

  it("skips DuckDuckGo internal links", () => {
    const html =
      '<div class="result">' +
      '<a class="result__a" href="https://duckduckgo.com/about">DDG About</a>' +
      '<a class="result__snippet">About DuckDuckGo</a>' +
      "</div>";
    expect(parseSearchResults(html, 5)).toHaveLength(0);
  });

  it("strips HTML tags from titles and snippets", () => {
    const html =
      '<div class="result">' +
      `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com")}"><b>Bold</b> Title</a>` +
      '<a class="result__snippet"><em>Italic</em> snippet &amp; more</a>' +
      "</div>";
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Bold Title");
    expect(results[0].snippet).toBe("Italic snippet & more");
  });
});

describe("parseSearchResults — hardened edge cases", () => {
  it("falls through to fallback when blocks yield no valid results", () => {
    // A result__a link exists in the HTML but outside any matched block.
    // The only matched block (result--ad at end) has no result__a inside.
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Forphan.com">Orphan Result</a>' +
      '<a class="result__snippet">Orphan snippet</a>' +
      '<div class="result--ad"><span>Ad</span></div>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://orphan.com");
    expect(results[0].title).toBe("Orphan Result");
  });

  it("decodes decimal and hex numeric HTML entities", () => {
    const html =
      '<div class="result">' +
      `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com")}">It&#39;s a test &#x2F; demo</a>` +
      '<a class="result__snippet">Price: &#36;99 &#x26; up</a>' +
      "</div>";
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("It's a test / demo");
    expect(results[0].snippet).toBe("Price: $99 & up");
  });

  it("handles direct HTTP URLs without DDG redirect", () => {
    const html =
      '<div class="result">' +
      '<a class="result__a" href="https://direct-link.com/page">Direct</a>' +
      '<a class="result__snippet">A direct URL</a>' +
      "</div>";
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://direct-link.com/page");
  });

  it("resolves protocol-relative URLs to https", () => {
    const html =
      '<div class="result">' +
      '<a class="result__a" href="//cdn.example.com/page">Proto Rel</a>' +
      '<a class="result__snippet">Should become https</a>' +
      "</div>";
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://cdn.example.com/page");
  });

  it("fallback handles fewer snippets than links", () => {
    // No div.result blocks → triggers fallback. Two links but only one snippet.
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com">Link A</a>' +
      '<a class="result__snippet">Snippet A</a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.com">Link B</a>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0].snippet).toBe("Snippet A");
    expect(results[1].snippet).toBe("");
  });

  it("fallback pairs snippets by position, not array index", () => {
    // Link A has no snippet, Link B has one. Index-based pairing would
    // incorrectly assign B's snippet to A. Positional pairing gets it right.
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com">Link A</a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.com">Link B</a>' +
      '<a class="result__snippet">Snippet for B</a>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://a.com");
    expect(results[0].snippet).toBe(""); // no snippet between A and B
    expect(results[1].url).toBe("https://b.com");
    expect(results[1].snippet).toBe("Snippet for B");
  });

  it("fallback ignores orphan snippets before any link", () => {
    const html =
      '<a class="result__snippet">Orphan snippet</a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com">Link A</a>' +
      '<a class="result__snippet">Real snippet</a>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("Real snippet");
  });

  it("fallback correctly pairs when middle link lacks snippet", () => {
    // A has snippet, B does not, C has snippet
    const html =
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com">A</a>' +
      '<a class="result__snippet">Snippet A</a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.com">B</a>' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fc.com">C</a>' +
      '<a class="result__snippet">Snippet C</a>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(3);
    expect(results[0].snippet).toBe("Snippet A");
    expect(results[1].snippet).toBe(""); // no snippet between B and C
    expect(results[2].snippet).toBe("Snippet C");
  });

  it("handles empty blocks without crashing", () => {
    const html =
      '<div class="result"></div>' +
      '<div class="result"></div>';
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(0);
  });
});

describe("parseBraveResults", () => {
  it("parses standard Brave API response", () => {
    const data = {
      web: {
        results: [
          { title: "TypeScript Handbook", url: "https://typescriptlang.org/docs", description: "Official TS docs" },
          { title: "TS Generics Guide", url: "https://example.com/generics", description: "Learn generics" },
        ],
      },
    };
    const results = parseBraveResults(data, 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "TypeScript Handbook",
      url: "https://typescriptlang.org/docs",
      snippet: "Official TS docs",
    });
  });

  it("respects max limit", () => {
    const data = {
      web: {
        results: [
          { title: "A", url: "https://a.com", description: "a" },
          { title: "B", url: "https://b.com", description: "b" },
          { title: "C", url: "https://c.com", description: "c" },
        ],
      },
    };
    expect(parseBraveResults(data, 2)).toHaveLength(2);
  });

  it("handles missing description", () => {
    const data = {
      web: {
        results: [{ title: "No Desc", url: "https://example.com" }],
      },
    };
    const results = parseBraveResults(data, 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("");
  });

  it("returns empty for missing web results", () => {
    expect(parseBraveResults({}, 5)).toHaveLength(0);
    expect(parseBraveResults({ web: {} }, 5)).toHaveLength(0);
    expect(parseBraveResults({ web: { results: [] } }, 5)).toHaveLength(0);
  });

  it("skips entries with missing title or url", () => {
    const data = {
      web: {
        results: [
          { title: "", url: "https://a.com", description: "no title" },
          { title: "No URL", url: "", description: "no url" },
          { title: "Valid", url: "https://b.com", description: "ok" },
        ],
      },
    };
    const results = parseBraveResults(data, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Valid");
  });
});

describe("parseSearchResults — entity decoding (cross-module: html-extract)", () => {
  const makeResult = (title: string, snippet: string) =>
    `<div class="result">` +
    `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com")}">${title}</a>` +
    `<a class="result__snippet">${snippet}</a>` +
    `</div>`;

  it("decodes &mdash; and &ndash; in titles", () => {
    const html = makeResult("Python &mdash; A Language", "Guide &ndash; overview");
    const results = parseSearchResults(html, 5);
    expect(results[0].title).toBe("Python — A Language");
    expect(results[0].snippet).toBe("Guide – overview");
  });

  it("decodes &hellip; in snippets (common truncation)", () => {
    const html = makeResult("Title", "This is a long snippet&hellip;");
    const results = parseSearchResults(html, 5);
    expect(results[0].snippet).toBe("This is a long snippet…");
  });

  it("decodes &apos; (apostrophe)", () => {
    const html = makeResult("It&apos;s working", "Don&apos;t panic");
    const results = parseSearchResults(html, 5);
    expect(results[0].title).toBe("It's working");
    expect(results[0].snippet).toBe("Don't panic");
  });

  it("decodes &trade; &copy; &reg; in titles", () => {
    const html = makeResult("Product&trade; by Corp&copy; &reg;", "Info");
    const results = parseSearchResults(html, 5);
    expect(results[0].title).toBe("Product™ by Corp© ®");
  });

  it("decodes &bull; and &middot; separators", () => {
    const html = makeResult("A &bull; B &middot; C", "separator test");
    const results = parseSearchResults(html, 5);
    expect(results[0].title).toBe("A • B · C");
  });

  it("decodes &laquo; and &raquo; quotation marks", () => {
    const html = makeResult("&laquo;Quoted&raquo;", "text");
    const results = parseSearchResults(html, 5);
    expect(results[0].title).toBe("«Quoted»");
  });

  it("decodes mixed named and numeric entities together", () => {
    const html = makeResult("A&mdash;B&#8212;C", "&hellip;more&#x2026;");
    const results = parseSearchResults(html, 5);
    // Both &mdash; (named) and &#8212; (numeric for em dash) should decode
    expect(results[0].title).toBe("A—B—C");
    expect(results[0].snippet).toBe("…more…");
  });

  it("fallback parser also decodes extended entities", () => {
    // No div.result blocks → triggers fallback parser
    const html =
      `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com")}">Title &mdash; test</a>` +
      `<a class="result__snippet">Snippet&hellip;</a>`;
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Title — test");
    expect(results[0].snippet).toBe("Snippet…");
  });
  it("handles malformed percent-encoding in uddg without crashing", () => {
    const html =
      '<div class="result">' +
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=%ZZbad%encoding">Title</a>' +
      '<a class="result__snippet">Snippet</a>' +
      "</div>";
    const results = parseSearchResults(html, 5);
    expect(results).toHaveLength(1);
    // Falls back to raw encoded string instead of crashing
    expect(results[0].url).toBe("%ZZbad%encoding");
    expect(results[0].title).toBe("Title");
  });
});

describe("runWebSearch — abort detection", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("detects AbortError by error name, not message content", () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    return runWebSearch({ query: "test" }).then((result) => {
      expect(result.content).toBe("Search timed out (15s)");
      expect(result.is_error).toBe(true);
    });
  });

  it("does not misidentify generic errors mentioning 'abort'", () => {
    const genericErr = new Error("Connection aborted by remote host");
    globalThis.fetch = vi.fn().mockRejectedValue(genericErr);

    return runWebSearch({ query: "test" }).then((result) => {
      expect(result.content).toBe("Search error: Connection aborted by remote host");
      expect(result.is_error).toBe(true);
    });
  });

  it("handles non-abort errors normally", () => {
    const networkErr = new Error("getaddrinfo ENOTFOUND html.duckduckgo.com");
    globalThis.fetch = vi.fn().mockRejectedValue(networkErr);

    return runWebSearch({ query: "test" }).then((result) => {
      expect(result.content).toContain("Search error:");
      expect(result.content).toContain("ENOTFOUND");
      expect(result.is_error).toBe(true);
    });
  });
});
