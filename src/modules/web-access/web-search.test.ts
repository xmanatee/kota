import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OutboundHttpDispatcher, OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { runWebSearch } from "./web-search.js";
import { parseBraveResults, parseSearchResults } from "./web-search-helpers.js";

const dispatcher = vi.fn<OutboundHttpDispatcher>();
const resultHtml =
  '<div class="result"><a class="result__a" href="https://example.com/result">CAPTCHA explained</a>' +
  '<a class="result__snippet">Search result</a></div>';

beforeEach(() => {
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  dispatcher.mockReset().mockResolvedValue(new Response(resultHtml));
  const transport = new OutboundHttpTransport({
    dispatcher,
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  vi.spyOn(outboundHttp, "request").mockImplementation((request) => transport.request(request));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("search parsing", () => {
  it.each([
    ["//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com", "https://example.com"],
    ["https://direct.example/page", "https://direct.example/page"],
    ["//cdn.example/page", "https://cdn.example/page"],
    ["//duckduckgo.com/l/?uddg=%ZZbad", "%ZZbad"],
  ])("resolves result URLs and decodes result text: %s", (href, url) => {
    const html =
      `<div class="result"><a class="result__a" href="${href}"><b>Title</b> &amp; &#x1F602;</a>` +
      '<a class="result__snippet"><em>Snippet</em> &#36;99\n  &mdash; more</a></div>';
    expect(parseSearchResults(html, 5)).toEqual([{ title: "Title & 😂", url, snippet: "Snippet $99 — more" }]);
  });

  it.each([
    "",
    '<div class="result"></div>',
    '<a class="result__a" href="https://duckduckgo.com/about">Internal</a>',
  ])("ignores absent and internal results: %s", (html) => {
    expect(parseSearchResults(html, 5)).toEqual([]);
  });

  it("limits structured results", () => {
    expect(parseSearchResults(resultHtml.repeat(3), 2)).toHaveLength(2);
  });

  it.each([
    "",
    '<div class="result--ad">Ad without a result link</div>',
  ])("pairs fallback snippets by position, including missing middle and trailing snippets: %s", (suffix) => {
    const html =
      '<a class="result__snippet">Orphan</a>' +
      '<a class="result__a" href="https://a.example">A</a><a class="result__snippet">A &amp; snippet</a>' +
      '<a class="result__a" href="https://b.example">B</a>' +
      '<a class="result__a" href="https://c.example">C</a><a class="result__snippet">C snippet</a>' +
      '<a class="result__a" href="https://d.example">D</a>' +
      suffix;
    expect(parseSearchResults(html, 5)).toEqual([
      { title: "A", url: "https://a.example", snippet: "A & snippet" },
      { title: "B", url: "https://b.example", snippet: "" },
      { title: "C", url: "https://c.example", snippet: "C snippet" },
      { title: "D", url: "https://d.example", snippet: "" },
    ]);
    expect(parseSearchResults(html, 2)).toHaveLength(2);
  });

  it("filters incomplete Brave entries and defaults absent descriptions", () => {
    expect(
      parseBraveResults(
        {
          web: {
            results: [
              { title: "", url: "missing-title" },
              { title: "Missing URL", url: "" },
              { title: "A", url: "https://a.example", description: "Snippet" },
              { title: "B", url: "https://b.example" },
              { title: "C", url: "https://c.example" },
            ],
          },
        },
        2,
      ),
    ).toEqual([
      { title: "A", url: "https://a.example", snippet: "Snippet" },
      { title: "B", url: "https://b.example", snippet: "" },
    ]);
    expect(parseBraveResults({}, 5)).toEqual([]);
    expect(parseBraveResults({ web: {} }, 5)).toEqual([]);
  });
});

describe("search provider selection", () => {
  it("encodes the query and renders results even when content discusses CAPTCHA", async () => {
    const result = await runWebSearch({ query: "A & B" });
    expect(dispatcher.mock.calls[0][0].searchParams.get("q")).toBe("A & B");
    expect(result).toEqual({ content: "1. CAPTCHA explained\n   https://example.com/result\n   Search result" });
  });

  it.each(["", "  "])("rejects empty queries: %j", async (query) => {
    expect(await runWebSearch({ query })).toMatchObject({ is_error: true });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it.each(["CAPTCHA", "Please try again", "Automated requests"])("reports provider blocking: %s", async (body) => {
    dispatcher.mockResolvedValue(new Response(body));
    expect(await runWebSearch({ query: "blocked" })).toMatchObject({
      is_error: true,
      content: expect.stringContaining("rate-limited"),
    });
  });

  it("uses configured Brave credentials and applies the result bound", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-token");
    dispatcher.mockResolvedValue(
      new Response(
        JSON.stringify({ web: { results: [{ title: "Brave", url: "https://example.com", description: "found" }] } }),
      ),
    );
    expect(await runWebSearch({ query: "test", num_results: 20 })).toEqual({
      content: "1. Brave\n   https://example.com\n   found",
    });
    const [target, init] = dispatcher.mock.calls[0];
    expect(target.origin).toBe("https://api.search.brave.com");
    expect(target.searchParams.get("count")).toBe("10");
    expect(new Headers(init.headers).get("x-subscription-token")).toBe("test-token");
  });

  it.each([
    503, 200,
  ])("falls back from unavailable Brave results (HTTP %i) without leaking its token", async (status) => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-token");
    dispatcher.mockResolvedValueOnce(new Response("{}", { status })).mockResolvedValueOnce(new Response(resultHtml));
    expect((await runWebSearch({ query: "fallback" })).content).toContain("CAPTCHA explained");
    const [target, init] = dispatcher.mock.calls[1];
    expect(target.hostname).toBe("html.duckduckgo.com");
    expect(new Headers(init.headers).has("x-subscription-token")).toBe(false);
  });

  it.each([
    ["brave", "https://unconfigured.example/final", "not selected by the configured-provider profile"],
    ["duck", "http://127.0.0.1/private", "loopback/private-network"],
  ])("keeps denied %s redirects terminal", async (provider, location, reason) => {
    if (provider === "brave") vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-token");
    dispatcher.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    expect(await runWebSearch({ query: "redirect" })).toMatchObject({
      is_error: true,
      content: expect.stringContaining(reason),
    });
    expect(dispatcher.mock.calls.map(([target]) => target.hostname)).toEqual([
      provider === "brave" ? "api.search.brave.com" : "html.duckduckgo.com",
    ]);
  });

  it.each([
    new DOMException("aborted", "AbortError"),
    new Error("Connection aborted by remote host"),
  ])("does not mislabel an adapter failure as a deadline: %s", async (error) => {
    dispatcher.mockRejectedValue(error);
    const result = await runWebSearch({ query: "error" });
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("Search error: network:") });
    expect(result.content).not.toContain("timed out");
  });

  it("distinguishes empty results from provider HTTP failure", async () => {
    dispatcher.mockResolvedValueOnce(new Response("")).mockResolvedValueOnce(new Response("failure", { status: 503 }));
    expect(await runWebSearch({ query: "nothing" })).toEqual({ content: "No results found for: nothing" });
    expect(await runWebSearch({ query: "failure" })).toEqual({ content: "Search failed: HTTP 503", is_error: true });
  });
});
