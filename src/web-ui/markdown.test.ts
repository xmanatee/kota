import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "./markdown.js";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('a "quoted" b')).toBe("a &quot;quoted&quot; b");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml(`<div class="x" data-y='z'>&`)).toBe(
      "&lt;div class=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;",
    );
  });

  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("passes through safe text unchanged", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });
});

describe("renderMarkdown", () => {
  describe("code blocks", () => {
    it("renders fenced code blocks", () => {
      const input = "```js\nconsole.log(1)\n```";
      expect(renderMarkdown(input)).toContain("<pre><code>");
      expect(renderMarkdown(input)).toContain("console.log(1)");
    });

    it("renders code blocks without language", () => {
      const input = "```\nhello\n```";
      expect(renderMarkdown(input)).toContain("<pre><code>hello");
    });
  });

  describe("inline code", () => {
    it("renders inline code", () => {
      expect(renderMarkdown("use `npm install`")).toContain(
        "<code>npm install</code>",
      );
    });
  });

  describe("text formatting", () => {
    it("renders bold text", () => {
      expect(renderMarkdown("this is **bold** text")).toContain(
        "<strong>bold</strong>",
      );
    });

    it("renders italic text", () => {
      expect(renderMarkdown("this is *italic* text")).toContain(
        "<em>italic</em>",
      );
    });
  });

  describe("headers", () => {
    it("renders h1", () => {
      expect(renderMarkdown("# Title")).toBe("<h2>Title</h2>");
    });

    it("renders h2", () => {
      expect(renderMarkdown("## Subtitle")).toBe("<h3>Subtitle</h3>");
    });

    it("renders h3", () => {
      expect(renderMarkdown("### Section")).toBe("<h4>Section</h4>");
    });
  });

  describe("links", () => {
    it("renders https links", () => {
      const result = renderMarkdown("[click](https://example.com)");
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener"');
      expect(result).toContain(">click</a>");
    });

    it("renders http links", () => {
      const result = renderMarkdown("[link](http://example.com)");
      expect(result).toContain('href="http://example.com"');
    });

    it("renders mailto links", () => {
      const result = renderMarkdown("[email](mailto:a@b.com)");
      expect(result).toContain('href="mailto:a@b.com"');
    });
  });

  describe("XSS prevention", () => {
    it("escapes HTML in regular text", () => {
      expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toContain(
        "<img",
      );
      expect(renderMarkdown("<img src=x onerror=alert(1)>")).toContain(
        "&lt;img",
      );
    });

    it("blocks javascript: protocol in links", () => {
      const result = renderMarkdown("[click](javascript:alert(1))");
      expect(result).not.toContain("href=");
    });

    it("blocks data: protocol in links", () => {
      const result = renderMarkdown(
        "[click](data:text/html,<script>alert(1)</script>)",
      );
      expect(result).not.toContain("href=");
    });

    it("blocks vbscript: protocol in links", () => {
      const result = renderMarkdown("[click](vbscript:msgbox)");
      expect(result).not.toContain("href=");
    });

    it("escapes quotes in link URLs to prevent attribute injection", () => {
      const result = renderMarkdown(
        '[click](https://evil.com" onclick="alert(1))',
      );
      // escapeHtml converts " to &quot; before link regex runs,
      // so the quote can't break out of the href attribute boundary
      expect(result).toContain("&quot;");
      // The href attribute value is intact — onclick is inside it, not a separate attribute
      expect(result).toMatch(/href="[^"]*&quot;[^"]*"/);
    });

    it("blocks javascript: with mixed case", () => {
      const result = renderMarkdown("[click](JavaScript:alert(1))");
      expect(result).not.toContain("href=");
    });

    it("blocks javascript: with leading whitespace", () => {
      const result = renderMarkdown("[click](  javascript:alert(1))");
      expect(result).not.toContain("href=");
    });
  });
});
