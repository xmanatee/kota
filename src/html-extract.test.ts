import { describe, it, expect } from "vitest";
import { extractContent, decodeEntities } from "./html-extract.js";

describe("extractContent", () => {
  describe("boilerplate removal", () => {
    it("removes script and style blocks", () => {
      const html = `<p>Hello</p><script>alert('x')</script><style>.x{}</style><p>World</p>`;
      const result = extractContent(html);
      expect(result).not.toContain("alert");
      expect(result).not.toContain(".x{}");
      expect(result).toContain("Hello");
      expect(result).toContain("World");
    });

    it("removes nav, header, footer, aside", () => {
      const html = `
        <header><a href="/">Logo</a><nav><a href="/about">About</a></nav></header>
        <main><p>Main content here</p></main>
        <aside><p>Sidebar stuff</p></aside>
        <footer><p>Copyright 2024</p></footer>
      `;
      const result = extractContent(html);
      expect(result).toContain("Main content here");
      expect(result).not.toContain("Sidebar stuff");
      expect(result).not.toContain("Copyright 2024");
      expect(result).not.toContain("Logo");
    });

    it("removes HTML comments", () => {
      const html = `<p>Before</p><!-- hidden comment --><p>After</p>`;
      const result = extractContent(html);
      expect(result).not.toContain("hidden comment");
      expect(result).toContain("Before");
      expect(result).toContain("After");
    });

    it("removes iframes and SVGs", () => {
      const html = `<p>Text</p><iframe src="ad.html"></iframe><svg><circle/></svg>`;
      const result = extractContent(html);
      expect(result).toBe("Text");
    });
  });

  describe("code block conversion", () => {
    it("converts pre+code with language to fenced block", () => {
      const html = `<pre><code class="language-python">def hello():\n    print("hi")</code></pre>`;
      const result = extractContent(html);
      expect(result).toContain("```python");
      expect(result).toContain('def hello():');
      expect(result).toContain('print("hi")');
      expect(result).toContain("```");
    });

    it("converts pre+code without language", () => {
      const html = `<pre><code>const x = 1;</code></pre>`;
      const result = extractContent(html);
      expect(result).toContain("```\nconst x = 1;\n```");
    });

    it("converts bare pre blocks", () => {
      const html = `<pre>plain text block</pre>`;
      const result = extractContent(html);
      expect(result).toContain("```\nplain text block\n```");
    });

    it("converts inline code", () => {
      const html = `<p>Use <code>npm install</code> to install</p>`;
      const result = extractContent(html);
      expect(result).toContain("`npm install`");
    });

    it("strips nested tags inside code blocks", () => {
      const html = `<pre><code><span class="keyword">const</span> x = 1;</code></pre>`;
      const result = extractContent(html);
      expect(result).toContain("const x = 1;");
      expect(result).not.toContain("span");
    });

    it("decodes entities inside code blocks", () => {
      const html = `<pre><code>if (a &lt; b &amp;&amp; c &gt; d) {}</code></pre>`;
      const result = extractContent(html);
      expect(result).toContain("if (a < b && c > d) {}");
    });
  });

  describe("heading conversion", () => {
    it("converts h1 through h6", () => {
      const html = `
        <h1>Title</h1>
        <h2>Section</h2>
        <h3>Subsection</h3>
        <h4>Detail</h4>
        <h5>Minor</h5>
        <h6>Tiny</h6>
      `;
      const result = extractContent(html);
      expect(result).toContain("# Title");
      expect(result).toContain("## Section");
      expect(result).toContain("### Subsection");
      expect(result).toContain("#### Detail");
      expect(result).toContain("##### Minor");
      expect(result).toContain("###### Tiny");
    });

    it("strips tags inside headings", () => {
      const html = `<h2><a href="/link">Section <em>Title</em></a></h2>`;
      const result = extractContent(html);
      expect(result).toContain("## Section Title");
    });
  });

  describe("list conversion", () => {
    it("converts list items to markdown", () => {
      const html = `<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>`;
      const result = extractContent(html);
      expect(result).toContain("- First item");
      expect(result).toContain("- Second item");
      expect(result).toContain("- Third item");
    });
  });

  describe("ordered list conversion", () => {
    it("converts ordered list to numbered items", () => {
      const html = `<ol><li>Preheat oven</li><li>Mix ingredients</li><li>Bake 30 min</li></ol>`;
      const result = extractContent(html);
      expect(result).toContain("1. Preheat oven");
      expect(result).toContain("2. Mix ingredients");
      expect(result).toContain("3. Bake 30 min");
    });

    it("preserves unordered list bullets alongside ordered lists", () => {
      const html = `<ol><li>Step one</li></ol><ul><li>Note A</li></ul>`;
      const result = extractContent(html);
      expect(result).toContain("1. Step one");
      expect(result).toContain("- Note A");
    });
  });

  describe("definition list conversion", () => {
    it("converts dl/dt/dd to bold term-definition pairs", () => {
      const html = `<dl><dt>CPU</dt><dd>Intel i7</dd><dt>RAM</dt><dd>32GB DDR5</dd></dl>`;
      const result = extractContent(html);
      expect(result).toContain("**CPU**: Intel i7");
      expect(result).toContain("**RAM**: 32GB DDR5");
    });
  });

  describe("image alt text", () => {
    it("extracts alt text from images", () => {
      const html = `<p>See the <img alt="system architecture diagram" src="arch.png"> below</p>`;
      const result = extractContent(html);
      expect(result).toContain("[Image: system architecture diagram]");
    });

    it("ignores images without alt attribute", () => {
      const html = `<p>Text <img src="spacer.gif"> more text</p>`;
      const result = extractContent(html);
      expect(result).not.toContain("[Image:");
      expect(result).toContain("Text");
      expect(result).toContain("more text");
    });
  });

  describe("structured content extraction (cross-module)", () => {
    it("extracts all structured elements from tutorial page", () => {
      const html = `
        <article>
          <h1>Getting Started</h1>
          <dl><dt>Prerequisites</dt><dd>Node.js 18+</dd><dt>Time</dt><dd>15 minutes</dd></dl>
          <h2>Steps</h2>
          <ol><li>Clone the repo</li><li>Install deps</li><li>Run the app</li></ol>
          <img alt="expected output screenshot" src="output.png">
          <table><tr><th>Command</th><th>Purpose</th></tr><tr><td>npm start</td><td>Run dev server</td></tr></table>
        </article>
      `;
      const result = extractContent(html);
      expect(result).toContain("**Prerequisites**: Node.js 18+");
      expect(result).toContain("1. Clone the repo");
      expect(result).toContain("3. Run the app");
      expect(result).toContain("[Image: expected output screenshot]");
      expect(result).toContain("| Command | Purpose |");
    });
  });

  describe("link conversion", () => {
    it("converts absolute links to markdown", () => {
      const html = `<p>See <a href="https://example.com/docs">the docs</a> for details.</p>`;
      const result = extractContent(html);
      expect(result).toContain("[the docs](https://example.com/docs)");
    });

    it("ignores relative and anchor links", () => {
      const html = `<a href="/about">About</a> <a href="#section">Jump</a>`;
      const result = extractContent(html);
      expect(result).not.toContain("[About]");
      expect(result).not.toContain("[Jump]");
    });
  });

  describe("emphasis conversion", () => {
    it("converts strong/b to bold", () => {
      const html = `<p>This is <strong>important</strong> and <b>bold</b></p>`;
      const result = extractContent(html);
      expect(result).toContain("**important**");
      expect(result).toContain("**bold**");
    });

    it("converts em/i to italic", () => {
      const html = `<p>This is <em>emphasized</em> and <i>italic</i></p>`;
      const result = extractContent(html);
      expect(result).toContain("*emphasized*");
      expect(result).toContain("*italic*");
    });
  });

  describe("blockquote conversion", () => {
    it("converts blockquotes with > prefix", () => {
      const html = `<blockquote>A wise saying</blockquote>`;
      const result = extractContent(html);
      expect(result).toContain("> A wise saying");
    });
  });

  describe("block elements", () => {
    it("converts hr to markdown rule", () => {
      const html = `<p>Above</p><hr><p>Below</p>`;
      const result = extractContent(html);
      expect(result).toContain("---");
    });

    it("converts br to newlines", () => {
      const html = `Line 1<br>Line 2<br/>Line 3`;
      const result = extractContent(html);
      expect(result).toContain("Line 1\nLine 2\nLine 3");
    });
  });

  describe("whitespace normalization", () => {
    it("collapses excessive blank lines", () => {
      const html = `<p>A</p>\n\n\n\n\n<p>B</p>`;
      const result = extractContent(html);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it("trims leading and trailing whitespace", () => {
      const html = `   <p>Content</p>   `;
      const result = extractContent(html);
      expect(result).toBe("Content");
    });
  });

  describe("entity decoding", () => {
    it("decodes common named entities", () => {
      const html = `<p>A &amp; B &mdash; C &lt; D &gt; E &quot;F&quot;</p>`;
      const result = extractContent(html);
      expect(result).toContain('A & B — C < D > E "F"');
    });

    it("decodes numeric entities", () => {
      const html = `<p>&#169; &#x2764;</p>`;
      const result = extractContent(html);
      expect(result).toContain("©");
      expect(result).toContain("❤");
    });
  });

  describe("table conversion", () => {
    it("converts table with th headers to markdown", () => {
      const html = `<table><tr><th>Product</th><th>Price</th></tr><tr><td>Widget</td><td>$10</td></tr><tr><td>Gadget</td><td>$20</td></tr></table>`;
      const result = extractContent(html);
      expect(result).toContain("| Product | Price |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Widget | $10 |");
      expect(result).toContain("| Gadget | $20 |");
    });

    it("converts table with thead/tbody wrappers", () => {
      const html = `<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>Alice</td><td>95</td></tr></tbody></table>`;
      const result = extractContent(html);
      expect(result).toContain("| Name | Score |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Alice | 95 |");
    });

    it("converts table without th (all td)", () => {
      const html = `<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>`;
      const result = extractContent(html);
      expect(result).toContain("| A | B |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| 1 | 2 |");
    });

    it("escapes pipe characters in cell content", () => {
      const html = `<table><tr><th>Command</th></tr><tr><td>a | b</td></tr></table>`;
      const result = extractContent(html);
      expect(result).toContain("a \\| b");
    });

    it("strips inline tags and handles br in cells", () => {
      const html = `<table><tr><th>Info</th></tr><tr><td><strong>Bold</strong> and<br>newline</td></tr></table>`;
      const result = extractContent(html);
      expect(result).toContain("| Bold and newline |");
    });

    it("normalizes uneven column counts", () => {
      const html = `<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>1</td><td>2</td></tr></table>`;
      const result = extractContent(html);
      expect(result).toContain("| A | B | C |");
      expect(result).toContain("| 1 | 2 | |");
    });
  });

  describe("realistic page extraction", () => {
    it("extracts documentation page content cleanly", () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>API Docs</title></head>
        <body>
          <header>
            <nav><a href="/">Home</a><a href="/api">API</a><a href="/blog">Blog</a></nav>
          </header>
          <main>
            <h1>API Reference</h1>
            <p>Welcome to the API documentation.</p>
            <h2>Authentication</h2>
            <p>Use <code>Bearer</code> tokens in the <code>Authorization</code> header:</p>
            <pre><code class="language-bash">curl -H "Authorization: Bearer TOKEN" https://api.example.com</code></pre>
            <h2>Endpoints</h2>
            <ul>
              <li>GET /users - List users</li>
              <li>POST /users - Create user</li>
            </ul>
            <p>See <a href="https://example.com/advanced">advanced docs</a> for more.</p>
          </main>
          <aside>
            <h3>Table of Contents</h3>
            <ul><li><a href="#auth">Auth</a></li><li><a href="#endpoints">Endpoints</a></li></ul>
          </aside>
          <footer>
            <p>Copyright 2024 Example Inc. <a href="/privacy">Privacy</a></p>
          </footer>
          <script>analytics.track('pageview')</script>
        </body>
        </html>
      `;
      const result = extractContent(html);

      // Main content preserved
      expect(result).toContain("# API Reference");
      expect(result).toContain("## Authentication");
      expect(result).toContain("## Endpoints");
      expect(result).toContain("`Bearer`");
      expect(result).toContain("```bash");
      expect(result).toContain("- GET /users - List users");
      expect(result).toContain("[advanced docs](https://example.com/advanced)");

      // Boilerplate removed
      expect(result).not.toContain("Home");
      expect(result).not.toContain("Blog");
      expect(result).not.toContain("Table of Contents");
      expect(result).not.toContain("Copyright");
      expect(result).not.toContain("Privacy");
      expect(result).not.toContain("analytics");
    });
  });
});

describe("decodeEntities", () => {
  it("handles mixed entity types", () => {
    expect(decodeEntities("&amp; &#38; &#x26;")).toBe("& & &");
  });

  it("passes through plain text", () => {
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });
});
