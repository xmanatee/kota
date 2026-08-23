import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRenderedArticleRead } from "./rendered-article-read.js";

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock("./lifecycle.js", () => ({ getPage: mocks.getPage }));

describe("rendered_article_read", () => {
  let page: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({}),
      url: vi.fn().mockReturnValue("https://example.com/article"),
      title: vi.fn().mockResolvedValue("Example article"),
      evaluate: vi.fn().mockResolvedValue("benign page"),
    };
    mocks.getPage.mockResolvedValue(page);
  });

  it("rejects missing or non-http URLs", async () => {
    expect((await runRenderedArticleRead({})).is_error).toBe(true);
    expect(
      (await runRenderedArticleRead({ url: "ftp://ex.com" })).is_error,
    ).toBe(true);
  });

  it("returns rendered text with URL and title headers", async () => {
    page.url.mockReturnValue(
      "https://openai.com/index/the-instruction-hierarchy/",
    );
    page.title.mockResolvedValue("The Instruction Hierarchy");
    const articleText =
      "The instruction hierarchy is a chain-of-command.".repeat(10);
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 1500)")) {
        return "Normal page body with content.";
      }
      return { text: articleText, usedSelector: "article" };
    });

    const result = await runRenderedArticleRead({
      url: "https://openai.com/index/the-instruction-hierarchy/",
    });

    expect(result.is_error).toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith(
      "https://openai.com/index/the-instruction-hierarchy/",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'article, main, [role="main"], body',
      { timeout: 30_000 },
    );
    expect(result.content).toContain("Title: The Instruction Hierarchy");
    expect(result.content).toContain("Extracted via: article");
    expect(result.content).toContain("instruction hierarchy");
  });

  it("flags a rendered Cloudflare challenge", async () => {
    page.url.mockReturnValue("https://example.com/jschallenge");
    page.evaluate.mockResolvedValue(
      "Just a moment... Checking your browser before accessing example.com",
    );
    const result = await runRenderedArticleRead({
      url: "https://example.com/jschallenge",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("JS / Cloudflare challenge");
  });

  it("detects an empty challenge from title and final URL", async () => {
    page.url.mockReturnValue(
      "https://example.com/article?__cf_chl_rt_tk=token",
    );
    page.title.mockResolvedValue("Just a moment...");
    page.evaluate.mockResolvedValue("");
    const result = await runRenderedArticleRead({
      url: "https://example.com/article",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("JS / Cloudflare challenge");
  });

  it("truncates excessively long article text", async () => {
    page.url.mockReturnValue("https://example.com/long");
    page.title.mockResolvedValue("Long");
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 1500)")) return "Benign body";
      return { text: "x".repeat(60_000), usedSelector: "article" };
    });
    const result = await runRenderedArticleRead({
      url: "https://example.com/long",
      max_length: 1000,
    });
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("showing first 1000");
  });

  it("surfaces timeout errors in a typed form", async () => {
    page.goto.mockRejectedValue(new Error("Timeout 30000ms exceeded."));
    const result = await runRenderedArticleRead({
      url: "https://example.com/slow",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("timeout");
  });

  it("honors a custom selector hint", async () => {
    page.url.mockReturnValue("https://example.com/x");
    page.title.mockResolvedValue("Scoped");
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 1500)")) return "Benign";
      expect(expression).toContain("#post-body");
      return {
        text: "Scoped content within #post-body",
        usedSelector: "#post-body",
      };
    });
    const result = await runRenderedArticleRead({
      url: "https://example.com/x",
      selector: "#post-body",
    });
    expect(page.waitForSelector).toHaveBeenCalledWith("#post-body", {
      timeout: 30_000,
    });
    expect(result.content).toContain("Extracted via: #post-body");
  });
});
