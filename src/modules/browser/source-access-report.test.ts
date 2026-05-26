import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToolMiddleware, resetToolMiddleware } from "#core/tools/tool-middleware.js";
import {
  runSourceAccessReport,
  type SourceAccessReportDeps,
  type SourceAccessReportOptions,
} from "./source-access-report.js";

describe("browser source-access report", () => {
  let tempDir: string;

  beforeEach(() => {
    resetToolMiddleware();
    tempDir = mkdtempSync(join(tmpdir(), "kota-browser-report-"));
  });

  afterEach(() => {
    resetToolMiddleware();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes an actionable no-Playwright report without invoking live readers", async () => {
    const callTool = vi.fn<SourceAccessReportDeps["callTool"]>();
    const result = await runSourceAccessReport(
      options({
        articleUrl: "https://openai.com/index/example/",
        xPostUrl: "https://x.com/example/status/1234567890",
      }),
      deps({ playwrightAvailable: false, callTool }),
    );

    expect(callTool).not.toHaveBeenCalled();
    expect(result.report.overall).toBe("not_ready");
    expect(result.report.checks.playwright.available).toBe(false);
    expect(result.report.reads.renderedArticle).toMatchObject({
      status: "skipped",
      failureKind: "missing_capability",
    });
    expect(result.report.nextSteps.join("\n")).toContain("Install the optional Playwright peer");
    assertArtifactsWritten(result.report.artifacts);
  });

  it("records missing profile configuration distinctly from Playwright availability", async () => {
    const result = await runSourceAccessReport(
      options({ config: {}, articleUrl: null, xPostUrl: null }),
      deps({ playwrightAvailable: true }),
    );

    expect(result.report.checks.playwright.available).toBe(true);
    expect(result.report.checks.storageState).toMatchObject({
      configured: false,
      resolvedPath: null,
      exists: null,
    });
    expect(result.report.nextSteps.join("\n")).toContain("storageStatePath");
  });

  it("records a configured profile path whose storage-state file is missing", async () => {
    const result = await runSourceAccessReport(
      options({
        config: { storageStatePath: "secrets/x-profile.json" },
        articleUrl: null,
        xPostUrl: null,
      }),
      deps({ playwrightAvailable: true }),
    );

    expect(result.report.checks.storageState.configured).toBe(true);
    expect(result.report.checks.storageState.exists).toBe(false);
    expect(result.report.checks.storageState.resolvedPath).toBe(
      join(tempDir, "secrets/x-profile.json"),
    );
  });

  it("records rendered article success with only a sanitized excerpt", async () => {
    const callTool = vi.fn<SourceAccessReportDeps["callTool"]>(async () => ({
      content:
        "URL: https://openai.com/index/example/\nTitle: Example\n\nRendered article body ".repeat(80),
    }));

    const result = await runSourceAccessReport(
      options({ articleUrl: "https://openai.com/index/example/" }),
      deps({ playwrightAvailable: true, callTool }),
    );

    expect(result.report.reads.renderedArticle).toMatchObject({
      status: "success",
      requestedUrl: "https://openai.com/index/example/",
    });
    if (result.report.reads.renderedArticle.status !== "success") {
      throw new Error("rendered article read should have succeeded");
    }
    expect(result.report.reads.renderedArticle.excerpt.length).toBeLessThanOrEqual(703);
    expect(callTool).toHaveBeenCalledWith("rendered_article_read", {
      url: "https://openai.com/index/example/",
      timeout: 30_000,
    });
  });

  it("classifies X auth-wall failures from the scoped reader", async () => {
    const callTool = vi.fn<SourceAccessReportDeps["callTool"]>(async () => ({
      content:
        "Unable to read X post: redirected to X login - session is not authenticated. Configure modules.browser.storageStatePath and retry.",
      is_error: true,
    }));

    const result = await runSourceAccessReport(
      options({ xPostUrl: "https://x.com/example/status/1234567890" }),
      deps({ playwrightAvailable: true, callTool }),
    );

    expect(result.report.reads.xPost).toMatchObject({
      status: "failure",
      failureKind: "auth_wall",
    });
  });

  it("writes a fully successful mocked report without credential leakage", async () => {
    const storageStatePath = join(tempDir, "x-profile.json");
    writeFileSync(storageStatePath, '{"cookies":[],"origins":[]}\n', "utf8");
    getToolMiddleware().add("test-screening-marker", async (_call, next) => {
      const result = await next();
      return { ...result, content: `${result.content}\n[screened-by-middleware]` };
    });
    const callTool = vi.fn<SourceAccessReportDeps["callTool"]>(
      async (name) => ({
        content:
          name === "x_post_read"
            ? "Author: Example\nPost:\nX post body auth_token=secret-cookie"
            : "URL: https://openai.com/index/example/\nTitle: Example\n\nArticle body Authorization: Bearer secret-token",
      }),
    );

    const result = await runSourceAccessReport(
      options({
        config: { storageStatePath },
        articleUrl: "https://openai.com/index/example/",
        xPostUrl: "https://x.com/example/status/1234567890",
      }),
      deps({ playwrightAvailable: true, callTool }),
    );
    const json = readFileSync(result.report.artifacts.jsonPath, "utf8");

    expect(result.report.overall).toBe("ready");
    expect(result.report.reads.renderedArticle.status).toBe("success");
    expect(result.report.reads.xPost.status).toBe("success");
    expect(json).toContain("[screened-by-middleware]");
    expect(json).toContain("[redacted]");
    expect(json).not.toContain("secret-cookie");
    expect(json).not.toContain("secret-token");
  });

  function options(
    overrides: Partial<SourceAccessReportOptions>,
  ): SourceAccessReportOptions {
    return {
      projectDir: tempDir,
      config: undefined,
      articleUrl: null,
      xPostUrl: null,
      articleSelector: null,
      timeoutMs: 30_000,
      runId: "test-source-access",
      outDir: null,
      ...overrides,
    };
  }

  function deps(overrides: {
    playwrightAvailable: boolean;
    callTool?: SourceAccessReportDeps["callTool"];
  }): SourceAccessReportDeps {
    return {
      isPlaywrightAvailable: () => overrides.playwrightAvailable,
      callTool:
        overrides.callTool ??
        vi.fn<SourceAccessReportDeps["callTool"]>(async () => ({
          content: "",
        })),
      now: () => new Date("2026-05-26T04:55:00.000Z"),
    };
  }
});

function assertArtifactsWritten(artifacts: {
  jsonPath: string;
  summaryPath: string;
  transcriptPath: string;
}): void {
  expect(existsSync(artifacts.jsonPath)).toBe(true);
  expect(existsSync(artifacts.summaryPath)).toBe(true);
  expect(existsSync(artifacts.transcriptPath)).toBe(true);
}
