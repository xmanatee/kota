import { describe, expect, it } from "vitest";
import {
  convertCodeBlocks,
  convertHeadings,
  convertInlineElements,
  convertTables,
  decodeEntities,
  finalCleanup,
  removeBlocks,
  stripTags,
} from "./html-extract-utils.js";

describe("decodeEntities", () => {
  it("decodes named entities", () => {
    expect(decodeEntities("&amp; &lt; &gt; &quot; &apos;")).toBe("& < > \" '");
  });

  it("decodes typographic entities", () => {
    expect(decodeEntities("&mdash; &ndash; &hellip; &bull;")).toBe("— – … •");
  });

  it("decodes decimal numeric entities", () => {
    expect(decodeEntities("&#169;")).toBe("©");
    expect(decodeEntities("&#128514;")).toBe("😂");
  });

  it("decodes hex numeric entities", () => {
    expect(decodeEntities("&#x26;")).toBe("&");
    expect(decodeEntities("&#x1F602;")).toBe("😂");
  });

  it("replaces null codepoint with replacement character", () => {
    expect(decodeEntities("&#0;")).toBe("\uFFFD");
  });

  it("preserves entity text for surrogate codepoints", () => {
    expect(decodeEntities("&#55296;")).toBe("&#55296;");
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
  });

  it("preserves entity text beyond unicode max", () => {
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
  });

  it("passes through plain text unchanged", () => {
    expect(decodeEntities("hello world")).toBe("hello world");
  });
});

describe("stripTags", () => {
  it("removes all HTML tags", () => {
    expect(stripTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes entities after stripping", () => {
    expect(stripTags("<p>A &amp; B</p>")).toBe("A & B");
  });

  it("trims surrounding whitespace", () => {
    expect(stripTags("  <span>text</span>  ")).toBe("text");
  });

  it("returns empty string for tag-only input", () => {
    expect(stripTags("<br/>")).toBe("");
  });
});

describe("removeBlocks", () => {
  it("removes named block elements", () => {
    const html = "<p>Keep</p><script>bad()</script><p>Also</p>";
    expect(removeBlocks(html, ["script"])).toBe("<p>Keep</p><p>Also</p>");
  });

  it("removes multiple tag types", () => {
    const html = "<p>A</p><style>.x{}</style><nav>nav</nav><p>B</p>";
    expect(removeBlocks(html, ["style", "nav"])).toBe("<p>A</p><p>B</p>");
  });

  it("is case-insensitive for tag names", () => {
    const html = "<p>OK</p><SCRIPT>x</SCRIPT>";
    expect(removeBlocks(html, ["script"])).toBe("<p>OK</p>");
  });

  it("handles multiline content inside removed blocks", () => {
    const html = "<p>A</p><script>\nfoo();\nbar();\n</script><p>B</p>";
    expect(removeBlocks(html, ["script"])).toBe("<p>A</p><p>B</p>");
  });

  it("returns original if no matching tags", () => {
    const html = "<p>Hello</p>";
    expect(removeBlocks(html, ["script"])).toBe("<p>Hello</p>");
  });
});

describe("convertCodeBlocks", () => {
  it("converts pre+code with language class to fenced block", () => {
    const phs: string[] = [];
    const html = `<pre><code class="language-ts">const x = 1;</code></pre>`;
    const result = convertCodeBlocks(html, phs);
    expect(phs[0]).toBe("```ts\nconst x = 1;\n```");
    expect(result).toContain("__KOTA_CODE_0__");
  });

  it("converts pre+code without language class to fenced block", () => {
    const phs: string[] = [];
    const html = `<pre><code>plain code</code></pre>`;
    convertCodeBlocks(html, phs);
    expect(phs[0]).toBe("```\nplain code\n```");
  });

  it("converts bare pre to fenced block", () => {
    const phs: string[] = [];
    const html = `<pre>raw block</pre>`;
    convertCodeBlocks(html, phs);
    expect(phs[0]).toBe("```\nraw block\n```");
  });

  it("converts inline code to backtick span", () => {
    const phs: string[] = [];
    const html = `<p>Use <code>npm install</code> here</p>`;
    const result = convertCodeBlocks(html, phs);
    expect(phs[0]).toBe("`npm install`");
    expect(result).toContain("__KOTA_CODE_0__");
  });

  it("appends placeholders sequentially", () => {
    const phs: string[] = [];
    const html = `<code>a</code><code>b</code>`;
    convertCodeBlocks(html, phs);
    expect(phs).toHaveLength(2);
    expect(phs[0]).toBe("`a`");
    expect(phs[1]).toBe("`b`");
  });

  it("decodes entities inside code blocks", () => {
    const phs: string[] = [];
    const html = `<pre><code>a &lt; b &amp;&amp; c &gt; d</code></pre>`;
    convertCodeBlocks(html, phs);
    expect(phs[0]).toBe("```\na < b && c > d\n```");
  });
});

describe("convertTables", () => {
  it("converts simple table to markdown", () => {
    const phs: string[] = [];
    const html = `<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`;
    convertTables(html, phs);
    expect(phs[0]).toContain("| A | B |");
    expect(phs[0]).toContain("| --- | --- |");
    expect(phs[0]).toContain("| 1 | 2 |");
  });

  it("escapes pipe characters in cells", () => {
    const phs: string[] = [];
    const html = `<table><tr><th>Cmd</th></tr><tr><td>a | b</td></tr></table>`;
    convertTables(html, phs);
    expect(phs[0]).toContain("a \\| b");
  });

  it("pads rows with fewer cells", () => {
    const phs: string[] = [];
    const html = `<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>1</td><td>2</td></tr></table>`;
    convertTables(html, phs);
    expect(phs[0]).toContain("| 1 | 2 |  |");
  });

  it("returns empty string for empty table", () => {
    const phs: string[] = [];
    const html = `<table></table>`;
    const result = convertTables(html, phs);
    expect(phs).toHaveLength(0);
    expect(result).toBe("");
  });
});

describe("convertHeadings", () => {
  it("converts h1 through h6 with correct prefix", () => {
    for (let i = 1; i <= 6; i++) {
      const html = `<h${i}>Title</h${i}>`;
      const result = convertHeadings(html);
      expect(result).toContain(`${"#".repeat(i)} Title`);
    }
  });

  it("strips inner tags from heading content", () => {
    const html = `<h2><a href="/x">Section <em>Title</em></a></h2>`;
    expect(convertHeadings(html)).toContain("## Section Title");
  });

  it("is case-insensitive for heading tags", () => {
    const html = `<H1>Big</H1>`;
    expect(convertHeadings(html)).toContain("# Big");
  });
});

describe("convertInlineElements", () => {
  it("converts ordered list to numbered items", () => {
    const html = `<ol><li>First</li><li>Second</li></ol>`;
    const result = convertInlineElements(html);
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("converts unordered list items to bullets", () => {
    const html = `<ul><li>Alpha</li><li>Beta</li></ul>`;
    const result = convertInlineElements(html);
    expect(result).toContain("- Alpha");
    expect(result).toContain("- Beta");
  });

  it("converts definition lists to bold pairs", () => {
    const html = `<dl><dt>CPU</dt><dd>Intel i7</dd><dt>RAM</dt><dd>32GB</dd></dl>`;
    const result = convertInlineElements(html);
    expect(result).toContain("**CPU**: Intel i7");
    expect(result).toContain("**RAM**: 32GB");
  });

  it("converts img alt to descriptive text", () => {
    const html = `<img alt="cat photo" src="cat.png">`;
    expect(convertInlineElements(html)).toContain("[Image: cat photo]");
  });

  it("ignores images without alt attribute", () => {
    const html = `<img src="spacer.gif">`;
    expect(convertInlineElements(html)).not.toContain("[Image:");
  });

  it("converts absolute links to markdown", () => {
    const html = `<a href="https://example.com">Docs</a>`;
    expect(convertInlineElements(html)).toContain("[Docs](https://example.com)");
  });

  it("does not convert relative links", () => {
    const html = `<a href="/about">About</a>`;
    expect(convertInlineElements(html)).not.toContain("[About]");
  });

  it("converts strong/b to bold markdown", () => {
    const html = `<strong>Important</strong> and <b>bold</b>`;
    const result = convertInlineElements(html);
    expect(result).toContain("**Important**");
    expect(result).toContain("**bold**");
  });

  it("converts em/i to italic markdown", () => {
    const html = `<em>stressed</em> and <i>italic</i>`;
    const result = convertInlineElements(html);
    expect(result).toContain("*stressed*");
    expect(result).toContain("*italic*");
  });

  it("converts blockquote with > prefix", () => {
    const html = `<blockquote>A wise saying</blockquote>`;
    expect(convertInlineElements(html)).toContain("> A wise saying");
  });
});

describe("finalCleanup", () => {
  it("restores placeholders", () => {
    const phs = ["```\ncode\n```"];
    const html = `text\n\n__KOTA_CODE_0__\n\nmore`;
    const result = finalCleanup(html, phs);
    expect(result).toContain("```\ncode\n```");
  });

  it("converts block-closing tags to newlines", () => {
    const html = `<div>A</div><div>B</div>`;
    const result = finalCleanup(html, []);
    expect(result).toContain("A\nB");
  });

  it("converts br to newline", () => {
    const html = `Line1<br>Line2<br/>Line3`;
    const result = finalCleanup(html, []);
    expect(result).toContain("Line1\nLine2\nLine3");
  });

  it("converts hr to markdown rule", () => {
    const html = `<p>A</p><hr><p>B</p>`;
    const result = finalCleanup(html, []);
    expect(result).toContain("---");
  });

  it("strips remaining tags", () => {
    const html = `<span class="x">text</span>`;
    expect(finalCleanup(html, [])).toBe("text");
  });

  it("decodes entities in remaining text", () => {
    const html = `A &amp; B`;
    expect(finalCleanup(html, [])).toBe("A & B");
  });

  it("collapses multiple blank lines", () => {
    const html = `A\n\n\n\n\nB`;
    const result = finalCleanup(html, []);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("trims leading and trailing whitespace", () => {
    const html = `   text   `;
    expect(finalCleanup(html, [])).toBe("text");
  });

  it("collapses inline spaces and tabs", () => {
    const html = `A  \t  B`;
    expect(finalCleanup(html, [])).toBe("A B");
  });
});
