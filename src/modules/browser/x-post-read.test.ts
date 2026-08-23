import { beforeEach, describe, expect, it, vi } from "vitest";
import { runXPostRead } from "./x-post-read.js";

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock("./lifecycle.js", () => ({ getPage: mocks.getPage }));

describe("x_post_read", () => {
  let page: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue({}),
      url: vi.fn().mockReturnValue("https://x.com/foo/status/1234567890"),
      evaluate: vi.fn().mockResolvedValue("benign page"),
    };
    mocks.getPage.mockResolvedValue(page);
  });

  it("rejects a missing or invalid URL", async () => {
    const missing = await runXPostRead({});
    expect(missing.is_error).toBe(true);
    expect(missing.content).toContain("url is required");

    const invalid = await runXPostRead({
      url: "https://example.com/not-a-tweet",
    });
    expect(invalid.is_error).toBe(true);
    expect(invalid.content).toContain(
      "must be a fully-qualified X/Twitter status URL",
    );
  });

  it("detects a redirect to login as an auth-wall failure", async () => {
    page.url.mockReturnValue(
      "https://x.com/i/flow/login?redirect_after_login=/foo/status/1",
    );
    page.evaluate.mockResolvedValue("Log in to X\nSign up");
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("redirected to X login");
    expect(result.content).toContain("storageStatePath");
  });

  it("detects rate-limit body text as a typed failure", async () => {
    page.evaluate.mockResolvedValue("Rate limit exceeded. Try again later.");
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("rate-limiting");
  });

  it("extracts the post body and requested replies", async () => {
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 2000)")) {
        return "Nothing gating visible here — real tweet content renders below.";
      }
      return {
        body: "The main tweet body.",
        author: "Foo User @foo",
        replies: ["First reply.", "Second reply.", "Third reply."],
      };
    });
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
      max_replies: 2,
    });

    expect(result.is_error).toBeUndefined();
    expect(page.goto).toHaveBeenCalledWith(
      "https://x.com/foo/status/1234567890",
      { waitUntil: "domcontentloaded", timeout: 20_000 },
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'article[data-testid="tweet"]',
      { timeout: 20_000 },
    );
    expect(result.content).toContain("The main tweet body.");
    expect(result.content).toContain("Foo User @foo");
    expect(result.content).toContain("Reply 1: First reply.");
    expect(result.content).toContain("Reply 2: Second reply.");
    expect(result.content).not.toContain("Reply 3:");
  });

  it("flags a missing tweet article as a typed failure", async () => {
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 2000)")) return "Some benign body text";
      return { body: null, author: null, replies: [] };
    });
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("did not render a tweet article");
  });

  it("falls back to article text when tweetText markup is absent", async () => {
    page.evaluate.mockImplementation(async (expression: string) => {
      if (expression.includes("slice(0, 2000)")) return "Some benign body text";
      if (expression.includes("cleanArticleText")) {
        return {
          body: "Foo User @foo\nThe post body rendered directly in the article.",
          author: "Foo User @foo",
          replies: [],
        };
      }
      return { body: null, author: null, replies: [] };
    });
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain(
      "The post body rendered directly in the article.",
    );
  });

  it("surfaces timeout errors in a typed form", async () => {
    page.goto.mockRejectedValue(
      new Error("Navigation timeout of 5000 ms exceeded"),
    );
    const result = await runXPostRead({
      url: "https://x.com/foo/status/1234567890",
      timeout: 5000,
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("timeout");
  });
});
