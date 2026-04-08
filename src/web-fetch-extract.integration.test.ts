/**
 * Cross-module integration tests: web-fetch → html-extract pipeline.
 * Tests that runWebFetch correctly delegates to extractContent and produces
 * well-formed Markdown output for complex HTML structures.
 *
 * Complements the basic cross-module tests in web-fetch.test.ts by covering
 * tables, blockquotes, entity-heavy content, and content-type edge cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWebFetch } from "./extensions/web-access/web-fetch.js";

function mockHtmlResponse(body: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
    body: { cancel: () => Promise.resolve() },
  };
}

function mockResponse(
  body: string,
  headers: Record<string, string> = {},
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
    body: { cancel: () => Promise.resolve() },
  };
}

describe("web-fetch → html-extract: tables", () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("converts HTML table to markdown table format", async () => {
    const html = `<html><body>
      <h2>Quarterly Results</h2>
      <table>
        <tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr>
        <tr><td>Q1</td><td>$1.2M</td><td>+15%</td></tr>
        <tr><td>Q2</td><td>$1.5M</td><td>+25%</td></tr>
      </table>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(mockHtmlResponse(html) as never);
    const result = await runWebFetch({ url: "https://example.com/report" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("## Quarterly Results");
    expect(result.content).toContain("| Quarter | Revenue | Growth |");
    expect(result.content).toContain("| --- | --- | --- |");
    expect(result.content).toContain("| Q1 | $1.2M | +15% |");
    expect(result.content).toContain("| Q2 | $1.5M | +25% |");
  });

  it("handles table with entities and inline HTML in cells", async () => {
    const html = `<html><body>
      <table>
        <tr><th>Feature</th><th>Status</th></tr>
        <tr><td><strong>Auth &amp; SSO</strong></td><td>Done &mdash; shipped</td></tr>
        <tr><td>API v2</td><td>In progress &hellip;</td></tr>
      </table>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(mockHtmlResponse(html) as never);
    const result = await runWebFetch({ url: "https://example.com/status" });
    expect(result.content).toContain("Auth & SSO");
    expect(result.content).toContain("Done — shipped");
    expect(result.content).toContain("In progress …");
  });
});

describe("web-fetch → html-extract: blockquotes and nested structures", () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("converts blockquotes to markdown format", async () => {
    const html = `<html><body>
      <article>
        <p>The report concluded:</p>
        <blockquote>Renewable energy capacity grew 50% year-over-year,
        driven primarily by solar and wind installations.</blockquote>
        <p>This marks a record.</p>
      </article>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(mockHtmlResponse(html) as never);
    const result = await runWebFetch({ url: "https://example.com/article" });
    expect(result.content).toContain("> ");
    expect(result.content).toContain("Renewable energy");
    expect(result.content).toContain("This marks a record");
  });

  it("handles complex page with headings, code, table, and links together", async () => {
    const html = `<html><head><title>API Docs</title></head><body>
      <nav><a href="/">Home</a></nav>
      <main>
        <h1>API Reference</h1>
        <p>Use the <code>fetch</code> function to make requests.</p>
        <h2>Endpoints</h2>
        <table>
          <tr><th>Method</th><th>Path</th></tr>
          <tr><td>GET</td><td>/api/users</td></tr>
        </table>
        <h2>Example</h2>
        <pre><code class="language-js">const res = await fetch("/api/users");
const data = await res.json();</code></pre>
        <p>See <a href="https://docs.example.com/auth">auth docs</a> for tokens.</p>
      </main>
      <footer><p>&copy; 2026</p></footer>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(mockHtmlResponse(html) as never);
    const result = await runWebFetch({ url: "https://example.com/docs" });
    // Headings preserved
    expect(result.content).toContain("# API Reference");
    expect(result.content).toContain("## Endpoints");
    expect(result.content).toContain("## Example");
    // Inline code preserved
    expect(result.content).toContain("`fetch`");
    // Table converted
    expect(result.content).toContain("| Method | Path |");
    expect(result.content).toContain("| GET | /api/users |");
    // Fenced code block
    expect(result.content).toContain("```js");
    expect(result.content).toContain("const res = await fetch");
    // Link preserved
    expect(result.content).toContain("[auth docs](https://docs.example.com/auth)");
    // Boilerplate stripped
    expect(result.content).not.toContain("Home");
    expect(result.content).not.toContain("© 2026");
  });
});

describe("web-fetch → html-extract: content-type edge cases", () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("returns raw text when content-type is not html", async () => {
    const xmlContent = `<?xml version="1.0"?><root><item>Hello</item></root>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(xmlContent, { "content-type": "application/xml" }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/feed.xml" });
    // XML is not html, so extractContent is NOT called — raw text returned
    expect(result.content).toContain("<root>");
    expect(result.content).toContain("<item>Hello</item>");
  });

  it("extracts HTML even with unusual html content-type variants", async () => {
    const html = `<html><body><h1>Title</h1><p>Content here.</p></body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, { "content-type": "text/html" }) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/page" });
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("Content here");
    // Tags stripped
    expect(result.content).not.toContain("<h1>");
    expect(result.content).not.toContain("<p>");
  });

  it("treats missing content-type as plain text (no extraction)", async () => {
    const html = `<html><body><h1>Title</h1></body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(
      mockResponse(html, {}) as never,
    );
    const result = await runWebFetch({ url: "https://example.com/unknown" });
    // No content-type → empty string → doesn't include "html" → raw text
    expect(result.content).toContain("<html>");
    expect(result.content).toContain("<h1>Title</h1>");
  });
});

describe("web-fetch → html-extract: entity handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; });

  it("decodes HTML entities throughout extracted content", async () => {
    const html = `<html><body>
      <h1>Q&amp;A &mdash; Frequently Asked</h1>
      <p>Temperature: 72&deg;F (22&deg;C). Price: &lt;$100.</p>
      <p>Copyright &copy; 2026. All rights reserved&trade;.</p>
    </body></html>`;
    vi.mocked(global.fetch).mockResolvedValue(mockHtmlResponse(html) as never);
    const result = await runWebFetch({ url: "https://example.com/faq" });
    expect(result.content).toContain("Q&A — Frequently Asked");
    expect(result.content).toContain("<$100");
    expect(result.content).toContain("©");
    expect(result.content).toContain("™");
  });
});
