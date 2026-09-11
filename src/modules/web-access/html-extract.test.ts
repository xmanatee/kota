import { describe, expect, it } from "vitest";
import { extractContent } from "./html-extract.js";

describe("HTML to Markdown", () => {
  it.each([
    [
      "boilerplate",
      "<p>Keep</p><SCRIPT>bad()\nmore()</SCRIPT><style>.ad{}</style><nav>nav</nav><header>header</header><footer>footer</footer><aside>aside</aside><iframe>frame</iframe><svg>svg</svg><!--comment-->",
      "Keep",
    ],
    [
      "language code",
      '<pre><code class="language-ts"><span>if</span> (a &lt; b) {}</code></pre>',
      "```ts\nif (a < b) {}\n```",
    ],
    ["plain code", "<pre><code>hello &#128514;</code></pre>", "```\nhello 😂\n```"],
    ["bare pre", "<pre>plain text</pre>", "```\nplain text\n```"],
    ["inline code order", "<code>a</code><code>b</code>", "`a`\n\n`b`"],
    ["nested heading tags", '<H2><a href="/docs">Section <em>title</em></a></H2>', "## Section title"],
    ["heading levels", "<h1>A</h1><h3>B</h3><h6>C</h6>", "# A\n\n### B\n\n###### C"],
    ["list kinds", "<ol><li>First</li><li>Second</li></ol><ul><li>Note</li></ul>", "1. First\n2. Second\n- Note"],
    ["definitions", "<dl><dt>CPU</dt><dd>Fast</dd><dt>RAM</dt><dd>32GB</dd></dl>", "**CPU**: Fast\n**RAM**: 32GB"],
    ["image alt", '<img alt="A &amp; B" src="a.png"><img src="spacer.gif">', "[Image: A & B]"],
    [
      "link kinds",
      '<a href="https://example.com">Docs</a> <a href="/about">About</a> <a href="#jump">Jump</a>',
      "[Docs](https://example.com) About Jump",
    ],
    ["emphasis", "<strong>A</strong> <b>B</b> <em>C</em> <i>D</i>", "**A** **B** *C* *D*"],
    ["quote", "<blockquote>A\nB</blockquote>", "> A\n> B"],
    ["block breaks", "<div>A</div><p>B<br>C<br/>D</p><hr><section>E</section>", "A\nB\nC\nD\n\n---\nE"],
    ["whitespace", "  <span>A  \t B</span>\n\n\n\n<p>C</p>  ", "A B\n\nC"],
    ["entities in prose", "<p>A &amp; B &#128514; &#x1F602; &#0; &#55296;</p>", "A & B 😂 😂 � &#55296;"],
    ["empty markup", "<table></table><span></span>", ""],
    [
      "table sections",
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    ],
    [
      "table cells",
      "<table><tr><td>A</td><td>B</td></tr><tr><td><strong>a | b</strong><br>c</td></tr></table>",
      "| A | B |\n| --- | --- |\n| a \\| b c | |",
    ],
  ])("renders %s", (_name, html, markdown) => {
    expect(extractContent(html)).toBe(markdown);
  });

  it("preserves code and tables together through page cleanup", () => {
    const html =
      '<h1>Guide</h1><pre><code class="language-js">a &lt; b</code></pre>' +
      "<table><tr><th>Value</th></tr><tr><td>3 &amp; 4</td></tr></table><p>Use <code>x</code>.</p>";
    const markdown = extractContent(html);
    expect(markdown).toContain("# Guide\n\n```js\na < b\n```");
    expect(markdown).toContain("| Value |\n| --- |\n| 3 & 4 |");
    expect(markdown).toContain("`x`");
    expect(markdown).not.toContain("__KOTA_");
  });
});
