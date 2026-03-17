import { describe, expect, it } from "vitest";
import {
  extractMetadata,
  extractPage,
  findContentRegion,
  formatMetadataHeader,
  removeBoilerplateByAttr,
} from "./html-page-extract.js";

describe("extractMetadata", () => {
  it("extracts title from <title> tag", () => {
    const html = `<html><head><title>My Page Title</title></head><body></body></html>`;
    const meta = extractMetadata(html);
    expect(meta.title).toBe("My Page Title");
  });

  it("prefers og:title over <title>", () => {
    const html = `<html><head>
      <title>Short Title</title>
      <meta property="og:title" content="Full OpenGraph Title">
    </head><body></body></html>`;
    const meta = extractMetadata(html);
    expect(meta.title).toBe("Full OpenGraph Title");
  });

  it("extracts description from meta name", () => {
    const html = `<html><head><meta name="description" content="A page about stuff"></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.description).toBe("A page about stuff");
  });

  it("prefers og:description over meta description", () => {
    const html = `<html><head>
      <meta name="description" content="Basic desc">
      <meta property="og:description" content="Rich desc for sharing">
    </head></html>`;
    const meta = extractMetadata(html);
    expect(meta.description).toBe("Rich desc for sharing");
  });

  it("extracts author", () => {
    const html = `<html><head><meta name="author" content="Jane Doe"></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.author).toBe("Jane Doe");
  });

  it("extracts article:published_time as date", () => {
    const html = `<html><head><meta property="article:published_time" content="2025-06-15T10:00:00Z"></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.date).toBe("2025-06-15T10:00:00Z");
  });

  it("extracts og:site_name", () => {
    const html = `<html><head><meta property="og:site_name" content="TechBlog"></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.siteName).toBe("TechBlog");
  });

  it("returns empty object for no metadata", () => {
    const html = `<html><body><p>Just content</p></body></html>`;
    const meta = extractMetadata(html);
    expect(Object.keys(meta)).toHaveLength(0);
  });

  it("decodes HTML entities in metadata", () => {
    const html = `<html><head><title>A &amp; B &mdash; Guide</title></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.title).toBe("A & B — Guide");
  });

  it("handles content attribute before name/property attribute", () => {
    const html = `<html><head><meta content="Reversed Order" name="description"></head></html>`;
    const meta = extractMetadata(html);
    expect(meta.description).toBe("Reversed Order");
  });
});

describe("findContentRegion", () => {
  it("finds <article> content", () => {
    const html = `<body>
      <nav><a href="/">Home</a></nav>
      <article><h1>Title</h1><p>${"x".repeat(150)}</p></article>
      <aside>Sidebar</aside>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("<h1>Title</h1>");
    expect(region).not.toContain("Home");
    expect(region).not.toContain("Sidebar");
  });

  it("finds <main> content", () => {
    const html = `<body>
      <header>Header</header>
      <main><p>${"Article content ".repeat(20)}</p></main>
      <footer>Footer</footer>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("Article content");
  });

  it("finds div with role=main", () => {
    const html = `<body>
      <div role="main"><p>${"Main content here ".repeat(10)}</p></div>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("Main content");
  });

  it("finds div with id=content", () => {
    const html = `<body>
      <div id="content"><p>${"The actual content ".repeat(10)}</p></div>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("actual content");
  });

  it("finds div with class entry-content", () => {
    const html = `<body>
      <div class="entry-content"><p>${"Blog post text ".repeat(10)}</p></div>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("Blog post text");
  });

  it("returns null when no content region found", () => {
    const html = `<body><div><p>Some text</p></div></body>`;
    expect(findContentRegion(html)).toBeNull();
  });

  it("rejects regions with too little text", () => {
    const html = `<article><a href="/link">Short</a></article>`;
    expect(findContentRegion(html)).toBeNull();
  });

  it("prioritizes article over main", () => {
    const html = `<body>
      <main><p>${"Main content ".repeat(20)}</p></main>
      <article><p>${"Article content ".repeat(20)}</p></article>
    </body>`;
    const region = findContentRegion(html);
    expect(region).toContain("Article content");
  });
});

describe("removeBoilerplateByAttr", () => {
  it("removes div with sidebar class", () => {
    const html = `<div class="sidebar"><p>Links</p></div><div class="main"><p>Content</p></div>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).not.toContain("Links");
    expect(result).toContain("Content");
  });

  it("removes section with comments id", () => {
    const html = `<section id="comments"><p>User comments</p></section><p>Article</p>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).not.toContain("User comments");
    expect(result).toContain("Article");
  });

  it("removes elements with newsletter class", () => {
    const html = `<div class="newsletter-signup"><p>Subscribe!</p></div><p>Content</p>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).not.toContain("Subscribe!");
    expect(result).toContain("Content");
  });

  it("removes elements with cookie/consent patterns", () => {
    const html = `<div class="cookie-consent"><p>Accept cookies</p></div><p>Main</p>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).not.toContain("Accept cookies");
  });

  it("preserves non-boilerplate divs", () => {
    const html = `<div class="article-body"><p>Real content</p></div>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).toContain("Real content");
  });

  it("removes social sharing widgets", () => {
    const html = `<div class="social-share"><a>Tweet</a><a>Share</a></div><p>Article</p>`;
    const result = removeBoilerplateByAttr(html);
    expect(result).not.toContain("Tweet");
    expect(result).toContain("Article");
  });
});

describe("formatMetadataHeader", () => {
  it("formats full metadata", () => {
    const header = formatMetadataHeader({
      title: "My Article",
      siteName: "TechBlog",
      author: "Jane Doe",
      date: "2025-06-15T10:00:00Z",
      description: "A great article about things",
    });
    expect(header).toContain("**My Article**");
    expect(header).toContain("TechBlog");
    expect(header).toContain("by Jane Doe");
    expect(header).toContain("2025-06-15");
    expect(header).toContain("> A great article about things");
    expect(header).toContain("---");
  });

  it("returns empty string for no metadata", () => {
    expect(formatMetadataHeader({})).toBe("");
  });

  it("formats title-only metadata", () => {
    const header = formatMetadataHeader({ title: "Simple Page" });
    expect(header).toContain("**Simple Page**");
    expect(header).toContain("---");
  });

  it("formats date without time component", () => {
    const header = formatMetadataHeader({ date: "2025-06-15T10:30:00+02:00" });
    expect(header).toContain("2025-06-15");
    expect(header).not.toContain("T10:30");
  });
});

describe("extractPage", () => {
  it("extracts metadata and content from full page", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>API Documentation</title>
      <meta name="description" content="Complete API reference">
      <meta name="author" content="Dev Team">
    </head><body>
      <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
      <article>
        <h1>API Reference</h1>
        <p>Welcome to the API documentation. Here you will find everything you need.</p>
        <h2>Authentication</h2>
        <p>Use Bearer tokens for all requests.</p>
      </article>
      <aside><h3>Quick Links</h3><ul><li>FAQ</li></ul></aside>
      <footer><p>Copyright 2025</p></footer>
    </body></html>`;
    const { metadata, content } = extractPage(html);

    expect(metadata.title).toBe("API Documentation");
    expect(metadata.description).toBe("Complete API reference");
    expect(metadata.author).toBe("Dev Team");

    expect(content).toContain("# API Reference");
    expect(content).toContain("## Authentication");
    expect(content).toContain("Bearer tokens");
    // Boilerplate removed
    expect(content).not.toContain("Home");
    expect(content).not.toContain("Quick Links");
    expect(content).not.toContain("Copyright");
  });

  it("removes sidebar and comment sections by class/id", () => {
    const html = `<html><body>
      <main>
        <h1>Blog Post</h1>
        <p>${"The actual blog post content that should be preserved. ".repeat(5)}</p>
        <div class="sidebar"><p>Trending posts</p></div>
        <section id="comments"><p>Leave a comment</p></section>
        <div class="social-share"><a>Share on Twitter</a></div>
      </main>
    </body></html>`;
    const { content } = extractPage(html);
    expect(content).toContain("# Blog Post");
    expect(content).toContain("blog post content");
    expect(content).not.toContain("Trending posts");
    expect(content).not.toContain("Leave a comment");
    expect(content).not.toContain("Share on Twitter");
  });

  it("removes form and template elements", () => {
    const html = `<html><body>
      <article>
        <h1>Contact Us</h1>
        <p>${"We would love to hear from you about our products. ".repeat(5)}</p>
        <form action="/submit"><input name="email"><button>Submit</button></form>
        <template><div>Hidden template content</div></template>
      </article>
    </body></html>`;
    const { content } = extractPage(html);
    expect(content).toContain("# Contact Us");
    expect(content).not.toContain("Submit");
    expect(content).not.toContain("Hidden template");
  });

  it("falls back to full page when no content region found", () => {
    const html = `<html><head><title>Simple Page</title></head><body>
      <div><p>Just some content without semantic markup.</p></div>
    </body></html>`;
    const { metadata, content } = extractPage(html);
    expect(metadata.title).toBe("Simple Page");
    expect(content).toContain("Just some content");
  });

  it("handles page with OpenGraph metadata", () => {
    const html = `<html><head>
      <meta property="og:title" content="Shared Article Title">
      <meta property="og:description" content="This is how it appears when shared">
      <meta property="og:site_name" content="TechCrunch">
      <meta property="article:published_time" content="2025-03-15T14:30:00Z">
      <meta property="article:author" content="Sarah Connor">
    </head><body>
      <article><p>${"Long article content about technology trends. ".repeat(5)}</p></article>
    </body></html>`;
    const { metadata } = extractPage(html);
    expect(metadata.title).toBe("Shared Article Title");
    expect(metadata.description).toBe("This is how it appears when shared");
    expect(metadata.siteName).toBe("TechCrunch");
    expect(metadata.date).toBe("2025-03-15T14:30:00Z");
    expect(metadata.author).toBe("Sarah Connor");
  });

  it("preserves code blocks through full pipeline", () => {
    const html = `<html><body><article>
      <h2>Usage</h2>
      <pre><code class="language-typescript">const x: number = 42;
console.log(x);</code></pre>
      <p>${"Explanation of the code and its purpose. ".repeat(5)}</p>
    </article></body></html>`;
    const { content } = extractPage(html);
    expect(content).toContain("```typescript");
    expect(content).toContain("const x: number = 42;");
    expect(content).toContain("## Usage");
  });

  it("handles realistic news article page", () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Breaking: AI Achieves Milestone - TechNews</title>
      <meta property="og:title" content="Breaking: AI Achieves Major Milestone">
      <meta property="og:description" content="A new AI system has demonstrated unprecedented capability">
      <meta property="og:site_name" content="TechNews">
      <meta name="author" content="Alex Reporter">
      <meta property="article:published_time" content="2025-06-15T08:00:00Z">
    </head><body>
      <header><nav><a href="/">TechNews</a><a href="/ai">AI</a><a href="/crypto">Crypto</a></nav></header>
      <main>
        <article>
          <h1>Breaking: AI Achieves Major Milestone</h1>
          <p>In a groundbreaking development, researchers announced today that their new AI system has demonstrated capabilities previously thought to be years away. The system showed remarkable performance across multiple benchmarks.</p>
          <h2>Technical Details</h2>
          <p>The model architecture combines several novel approaches including advanced reasoning chains and improved context management. Researchers noted significant improvements in both accuracy and efficiency.</p>
          <blockquote>This represents a paradigm shift in how we think about AI capabilities, said lead researcher Dr. Smith.</blockquote>
          <h2>Industry Reaction</h2>
          <p>Major tech companies have responded with both excitement and caution. Several announced plans to integrate similar approaches into their own products.</p>
          <ul>
            <li>Company A plans integration by Q3</li>
            <li>Company B sees potential in healthcare</li>
            <li>Company C warns of safety considerations</li>
          </ul>
        </article>
        <div class="related-articles"><h3>Related</h3><a href="/article1">Older AI News</a></div>
        <div class="social-share"><a>Share</a><a>Tweet</a></div>
      </main>
      <div class="sidebar"><h3>Trending</h3><ul><li>Story 1</li><li>Story 2</li></ul></div>
      <div class="newsletter-signup"><h3>Subscribe</h3><form><input><button>Sign up</button></form></div>
      <footer><p>Copyright 2025 TechNews. All rights reserved.</p><nav><a href="/privacy">Privacy</a></nav></footer>
      <script>analytics.track('pageview')</script>
    </body></html>`;
    const { metadata, content } = extractPage(html);

    // Metadata
    expect(metadata.title).toBe("Breaking: AI Achieves Major Milestone");
    expect(metadata.description).toBe("A new AI system has demonstrated unprecedented capability");
    expect(metadata.siteName).toBe("TechNews");
    expect(metadata.author).toBe("Alex Reporter");
    expect(metadata.date).toBe("2025-06-15T08:00:00Z");

    // Content preserved
    expect(content).toContain("# Breaking: AI Achieves Major Milestone");
    expect(content).toContain("## Technical Details");
    expect(content).toContain("## Industry Reaction");
    expect(content).toContain("> This represents a paradigm shift");
    expect(content).toContain("- Company A plans integration by Q3");

    // Boilerplate removed
    expect(content).not.toContain("Crypto");
    expect(content).not.toContain("Trending");
    expect(content).not.toContain("Subscribe");
    expect(content).not.toContain("Sign up");
    expect(content).not.toContain("Copyright");
    expect(content).not.toContain("analytics");
    expect(content).not.toContain("Older AI News");
    expect(content).not.toContain("Tweet");
  });
});
