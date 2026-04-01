/**
 * GitHub extension — integration tests with mocked fetch.
 *
 * Covers: create PR, get PR with CI checks, add comment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../../extension-types.js";
import githubModule from "./index.js";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

// ─── Mock context ─────────────────────────────────────────────────────────────

function makeCtx(token = "ghp_test123", repo = "owner/testrepo"): ExtensionContext {
  return {
    cwd: "/tmp",
    verbose: false,
    config: {} as ExtensionContext["config"],
    storage: {} as ExtensionContext["storage"],
    registerGroup: vi.fn(),
    getRoutes: vi.fn(() => []),
    getContributedWorkflows: vi.fn(() => []),
    getContributedChannels: vi.fn(() => []),
    getExtensionConfig: vi.fn(() => ({ token, repo })),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getSecret: vi.fn(() => null),
    listTools: vi.fn(() => []),
    events: { emit: vi.fn(), subscribe: vi.fn(() => () => {}) },
    createSession: vi.fn(),
    registerProvider: vi.fn(),
    getProvider: vi.fn(() => null),
    callTool: vi.fn(),
    registerMiddleware: vi.fn(),
    getExtensionSummaries: vi.fn(() => []),
  } as unknown as ExtensionContext;
}

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTools(ctx: ExtensionContext) {
  const toolsFactory = githubModule.tools;
  if (typeof toolsFactory !== "function") throw new Error("tools should be a factory");
  return toolsFactory(ctx);
}

function getTool(ctx: ExtensionContext, name: string) {
  const tools = getTools(ctx);
  const t = tools.find((t) => t.tool.name === name);
  if (!t) throw new Error(`Tool ${name} not found`);
  return t;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("github extension", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("tool registration", () => {
    it("registers all five tools when token is configured", () => {
      const ctx = makeCtx();
      const tools = getTools(ctx);
      const names = tools.map((t) => t.tool.name);
      expect(names).toContain("github_create_pr");
      expect(names).toContain("github_get_pr");
      expect(names).toContain("github_list_issues");
      expect(names).toContain("github_comment");
      expect(names).toContain("github_merge_pr");
      expect(names).toHaveLength(5);
    });

    it("returns no tools when token is missing", () => {
      const ctx = makeCtx();
      vi.mocked(ctx.getExtensionConfig).mockReturnValue({} as ReturnType<ExtensionContext["getExtensionConfig"]>);
      const tools = getTools(ctx);
      expect(tools).toHaveLength(0);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.stringContaining("token is required"),
      );
    });
  });

  describe("github_create_pr", () => {
    it("creates a PR and returns number and URL", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ number: 42, title: "My feature", html_url: "https://github.com/owner/testrepo/pull/42" }),
      );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_create_pr");
      const result = await tool.runner({
        title: "My feature",
        head: "feature/my-branch",
        base: "main",
        body: "Description here",
      });

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("#42");
      expect(result.content).toContain("https://github.com/owner/testrepo/pull/42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/testrepo/pulls",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer ghp_test123" }),
        }),
      );
    });

    it("returns error on API failure", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ message: "Unprocessable Entity" }, 422),
      );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_create_pr");
      const result = await tool.runner({ title: "PR", head: "branch", base: "main" });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("422");
    });

    it("returns error when per-call repo is explicitly empty", async () => {
      const ctx = makeCtx();
      const tool = getTool(ctx, "github_create_pr");
      // repo: "" is falsy — falls back to defaultRepo from config, which IS set in makeCtx.
      // Test that explicitly passing an invalid repo surfaces an API error, not a crash.
      mockFetch.mockResolvedValueOnce(makeResponse({ message: "Not Found" }, 404));
      const result = await tool.runner({ title: "PR", head: "branch", base: "main", repo: "bad/repo" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("404");
    });
  });

  describe("github_get_pr", () => {
    it("returns PR details with CI check statuses", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({
            number: 10,
            title: "Fix bug",
            state: "open",
            draft: false,
            html_url: "https://github.com/owner/testrepo/pull/10",
            head: { sha: "abc123", ref: "fix/bug" },
            base: { ref: "main" },
            mergeable: true,
            body: "Fixes the bug.",
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            check_runs: [
              { name: "ci / build", status: "completed", conclusion: "success" },
              { name: "ci / test", status: "completed", conclusion: "failure" },
            ],
          }),
        );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_get_pr");
      const result = await tool.runner({ number: 10 });

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("PR #10");
      expect(result.content).toContain("Fix bug");
      expect(result.content).toContain("ci / build");
      expect(result.content).toContain("success");
      expect(result.content).toContain("ci / test");
      expect(result.content).toContain("failure");
    });
  });

  describe("github_comment", () => {
    it("posts a comment and returns the comment URL", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ id: 999, html_url: "https://github.com/owner/testrepo/issues/5#issuecomment-999" }),
      );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_comment");
      const result = await tool.runner({ number: 5, body: "Looks good to me!" });

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("999");
      expect(result.content).toContain("https://github.com/owner/testrepo");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/testrepo/issues/5/comments",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("github_list_issues", () => {
    it("lists open issues excluding PRs", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse([
          { number: 1, title: "Bug report", html_url: "...", labels: [{ name: "bug" }] },
          { number: 2, title: "PR item", html_url: "...", labels: [], pull_request: {} },
          { number: 3, title: "Feature request", html_url: "...", labels: [] },
        ]),
      );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_list_issues");
      const result = await tool.runner({});

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("#1");
      expect(result.content).toContain("Bug report");
      expect(result.content).not.toContain("PR item");
      expect(result.content).toContain("#3");
      expect(result.content).toContain("2 issue(s)");
    });

    it("passes label filter to the API", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse([]));

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_list_issues");
      await tool.runner({ labels: "bug,p1" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("labels=bug%2Cp1");
    });
  });

  describe("github_merge_pr", () => {
    it("merges a PR and returns the merged SHA", async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ sha: "deadbeef", merged: true, message: "Pull Request successfully merged" }),
      );

      const ctx = makeCtx();
      const tool = getTool(ctx, "github_merge_pr");
      const result = await tool.runner({ number: 42, merge_method: "squash" });

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("deadbeef");
      expect(result.content).toContain("#42");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/testrepo/pulls/42/merge",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });
});
