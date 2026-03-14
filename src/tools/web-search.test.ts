import { describe, it, expect } from "vitest";
import { isRateLimited, parseSearchResults } from "./web-search.js";

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
    // A result about CAPTCHAs should not trigger rate limit detection
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
