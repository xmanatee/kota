import { describe, expect, it } from "vitest";
import { escapeHtml, fmtDuration, fmtUptime, renderMarkdown } from "./utils";

describe("fmtDuration", () => {
  it("formats milliseconds", () => expect(fmtDuration(500)).toBe("500ms"));
  it("formats seconds", () => expect(fmtDuration(5000)).toBe("5.0s"));
  it("formats minutes", () => expect(fmtDuration(125000)).toBe("2m5s"));
  it("returns empty for 0", () => expect(fmtDuration(0)).toBe(""));
});

describe("fmtUptime", () => {
  it("formats seconds", () => {
    const now = new Date(Date.now() - 30000).toISOString();
    expect(fmtUptime(now)).toBe("30s");
  });

  it("formats hours and minutes", () => {
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000 - 5 * 60 * 1000,
    ).toISOString();
    expect(fmtUptime(twoHoursAgo)).toBe("2h 5m");
  });
});

describe("escapeHtml", () => {
  it("escapes special chars", () => {
    expect(escapeHtml('<script>"test"</script>')).toBe(
      "&lt;script&gt;&quot;test&quot;&lt;/script&gt;",
    );
  });
});

describe("renderMarkdown", () => {
  it("renders code blocks", () => {
    expect(renderMarkdown("```js\nconst x = 1;\n```")).toContain("<pre><code>");
  });

  it("renders bold text", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("renders inline code", () => {
    expect(renderMarkdown("`code`")).toContain("<code>code</code>");
  });

  it("renders safe links", () => {
    const result = renderMarkdown("[link](https://example.com)");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
  });

  it("rejects javascript links", () => {
    const result = renderMarkdown("[link](javascript:alert(1))");
    expect(result).not.toContain("href");
  });
});
