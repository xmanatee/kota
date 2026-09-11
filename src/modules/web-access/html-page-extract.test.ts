import { describe, expect, it } from "vitest";
import { extractPage, formatMetadataHeader } from "./html-page-extract.js";

describe("page extraction", () => {
  it("selects metadata precedence and renders the complete header", () => {
    const { metadata } = extractPage(`<title>Fallback title</title>
      <meta name="description" content="Fallback description">
      <meta content="Chosen &amp; decoded" property="og:title">
      <meta property="og:description" content="Summary">
      <meta name="author" content="Author"><meta property="article:author" content="Other">
      <meta name="date" content="old"><meta property="article:published_time" content="2025-06-15T12:00:00Z">
      <meta property="og:site_name" content="Site">`);
    expect(metadata).toEqual({
      title: "Chosen & decoded",
      description: "Summary",
      author: "Author",
      date: "2025-06-15T12:00:00Z",
      siteName: "Site",
    });
    expect(formatMetadataHeader(metadata)).toBe(
      "**Chosen & decoded**\nSite · by Author · 2025-06-15\n> Summary\n\n---\n",
    );
  });

  it.each([
    ["<title><b>Plain &amp; title</b></title>", { title: "Plain & title" }],
    ['<meta content="Description" name="description">', { description: "Description" }],
    ['<meta property="article:author" content="Author">', { author: "Author" }],
    ['<meta name="date" content="2025-01-01">', { date: "2025-01-01" }],
    ['<meta property="article:modified_time" content="yesterday">', { date: "yesterday" }],
    ['<meta name="author" content="">', {}],
  ])("uses metadata fallbacks: %s", (html, metadata) => {
    expect(extractPage(html).metadata).toEqual(metadata);
  });

  it.each([
    ["article", ""],
    ["main", ""],
    ["div", 'role="main"'],
    ["div", 'id="content"'],
    ["div", 'class="entry-content"'],
  ])("selects a substantial %s %s region", (tag, attributes) => {
    const text = "The complete article content is retained for the reader. ".repeat(3).trim();
    expect(extractPage(`<p>Outside</p><${tag} ${attributes}><p>${text}</p></${tag}>`).content).toBe(text);
  });

  it("prefers article over main and falls back when the region is too short", () => {
    const main = "Main content. ".repeat(12);
    const article = "Article content. ".repeat(12);
    expect(extractPage(`<main>${main}</main><article>${article}</article>`).content).toBe(article.trim());
    expect(extractPage("<p>Outside</p><article>Short</article>").content).toBe("Outside\nShort");
    expect(extractPage("<p>Just content</p>")).toEqual({ metadata: {}, content: "Just content" });
  });

  it("removes attributed boilerplate and forms while preserving rich article content", () => {
    const { content } = extractPage(`<article><h1>Guide</h1>
      <p>${"The article explains the code below. ".repeat(5)}</p>
      <pre><code class="language-ts">const value = 42;</code></pre>
      <div class="article-body"><p>Kept body</p></div>
      <div class="sidebar">Discard sidebar</div><section id="comments">Discard comments</section>
      <div class="newsletter-signup">Discard newsletter</div><div class="cookie-consent">Discard cookie</div>
      <div class="social-share">Discard share</div><form>Discard form</form><template>Discard template</template>
      </article>`);
    expect(content).toContain("# Guide");
    expect(content).toContain("```ts\nconst value = 42;\n```");
    expect(content).toContain("Kept body");
    expect(content).not.toContain("Discard");
  });

  it("renders only present metadata, preserving non-ISO dates", () => {
    expect(formatMetadataHeader({})).toBe("");
    expect(formatMetadataHeader({ title: "Title" })).toBe("**Title**\n\n---\n");
    expect(formatMetadataHeader({ date: "yesterday" })).toBe("yesterday\n\n---\n");
  });
});
