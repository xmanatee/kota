import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import {
  type RawBrowserModuleConfig,
  resolveBrowserProfileConfig,
  resolveStorageStatePath,
} from "./config.js";

const REPORT_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const EXCERPT_LIMIT = 700;

export type SourceAccessReadName = "rendered_article_read" | "x_post_read";

export type SourceAccessFailureKind =
  | "missing_capability"
  | "not_requested"
  | "auth_wall"
  | "js_gate"
  | "timeout"
  | "rate_limit"
  | "invalid_input"
  | "tool_error";

export type SourceAccessReadResult =
  | {
      tool: SourceAccessReadName;
      status: "success";
      requestedUrl: string;
      contentLength: number;
      excerpt: string;
    }
  | {
      tool: SourceAccessReadName;
      status: "failure" | "skipped";
      requestedUrl: string | null;
      failureKind: SourceAccessFailureKind;
      message: string;
    };

export type BrowserSourceAccessReport = {
  version: 1;
  generatedAt: string;
  projectDir: string;
  outDir: string;
  overall: "ready" | "not_ready";
  checks: {
    playwright: {
      available: boolean;
      message: string;
    };
    storageState: {
      configured: boolean;
      configuredPath: string | null;
      resolvedPath: string | null;
      exists: boolean | null;
      message: string;
    };
    persistProfile: {
      enabled: boolean;
      message: string;
    };
  };
  reads: {
    renderedArticle: SourceAccessReadResult;
    xPost: SourceAccessReadResult;
  };
  nextSteps: string[];
  artifacts: {
    jsonPath: string;
    summaryPath: string;
    transcriptPath: string;
  };
};

export type SourceAccessReportOptions = {
  projectDir: string;
  config: RawBrowserModuleConfig;
  articleUrl: string | null;
  xPostUrl: string | null;
  articleSelector: string | null;
  timeoutMs: number;
  runId: string | null;
  outDir: string | null;
};

export type SourceAccessReportDeps = {
  isPlaywrightAvailable: () => boolean;
  callTool: ModuleContext["callTool"];
  now: () => Date;
};

export type SourceAccessReportRunResult = {
  report: BrowserSourceAccessReport;
  summary: string;
  transcript: string;
};

export function defaultSourceAccessReportOptions(
  projectDir: string,
): SourceAccessReportOptions {
  return {
    projectDir,
    config: undefined,
    articleUrl: null,
    xPostUrl: null,
    articleSelector: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runId: null,
    outDir: null,
  };
}

export async function runSourceAccessReport(
  options: SourceAccessReportOptions,
  deps: SourceAccessReportDeps,
): Promise<SourceAccessReportRunResult> {
  const generatedAt = deps.now().toISOString();
  const outDir = resolveReportOutDir(options, generatedAt);
  mkdirSync(outDir, { recursive: true });

  const profile = resolveBrowserProfileConfig(options.config);
  const resolvedPath = resolveStorageStatePath(
    profile.storageStatePath,
    options.projectDir,
  );
  const storageExists = resolvedPath === null ? null : existsSync(resolvedPath);
  const playwrightAvailable = deps.isPlaywrightAvailable();

  const preflight = {
    playwright: {
      available: playwrightAvailable,
      message: playwrightAvailable
        ? "Playwright resolves in this project runtime."
        : "Playwright is not installed or cannot be resolved in this project runtime.",
    },
    storageState: {
      configured: profile.storageStatePath !== null,
      configuredPath: profile.storageStatePath,
      resolvedPath,
      exists: storageExists,
      message: storageStateMessage(profile.storageStatePath, storageExists),
    },
    persistProfile: {
      enabled: profile.persist,
      message: profile.persist
        ? "persistProfile is enabled; this run may update the configured storage-state file when browser state closes."
        : "persistProfile is disabled; this run will not write browser profile state back to disk.",
    },
  };

  const renderedArticle = await runRequestedRead(
    "rendered_article_read",
    options.articleUrl,
    playwrightAvailable,
    deps,
    {
      timeout: options.timeoutMs,
      ...(options.articleSelector !== null
        ? { selector: options.articleSelector }
        : {}),
    },
  );
  const xPost = await runRequestedRead(
    "x_post_read",
    options.xPostUrl,
    playwrightAvailable,
    deps,
    { timeout: options.timeoutMs },
  );

  const jsonPath = join(outDir, "source-access-report.json");
  const summaryPath = join(outDir, "source-access-summary.md");
  const transcriptPath = join(outDir, "source-access-transcript.txt");
  const nextSteps = buildNextSteps(preflight, renderedArticle, xPost);
  const overall =
    playwrightAvailable &&
      preflight.storageState.configured &&
      preflight.storageState.exists === true &&
      renderedArticle.status === "success" &&
      xPost.status === "success"
      ? "ready"
      : "not_ready";

  const report: BrowserSourceAccessReport = {
    version: REPORT_VERSION,
    generatedAt,
    projectDir: options.projectDir,
    outDir,
    overall,
    checks: preflight,
    reads: { renderedArticle, xPost },
    nextSteps,
    artifacts: { jsonPath, summaryPath, transcriptPath },
  };
  const summary = renderReportSummary(report);
  const transcript = renderReportTranscript(report);

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, summary, "utf8");
  writeFileSync(transcriptPath, transcript, "utf8");

  return { report, summary, transcript };
}

function resolveReportOutDir(
  options: SourceAccessReportOptions,
  generatedAt: string,
): string {
  if (options.outDir !== null) return options.outDir;
  const runId =
    options.runId ??
    `browser-source-access-${generatedAt.replaceAll(/[:.]/g, "-")}`;
  return join(options.projectDir, ".kota", "runs", runId);
}

function storageStateMessage(
  configuredPath: string | null,
  exists: boolean | null,
): string {
  if (configuredPath === null) {
    return "modules.browser.storageStatePath is not configured.";
  }
  if (exists === true) {
    return "Configured storage-state file exists.";
  }
  return "Configured storage-state file does not exist.";
}

async function runRequestedRead(
  tool: SourceAccessReadName,
  requestedUrl: string | null,
  playwrightAvailable: boolean,
  deps: SourceAccessReportDeps,
  extraInput: { timeout: number; selector?: string },
): Promise<SourceAccessReadResult> {
  if (requestedUrl === null) {
    return {
      tool,
      status: "skipped",
      requestedUrl,
      failureKind: "not_requested",
      message: `${tool} was not requested.`,
    };
  }
  if (!playwrightAvailable) {
    return {
      tool,
      status: "skipped",
      requestedUrl,
      failureKind: "missing_capability",
      message:
        "Skipped because Playwright is not installed or cannot be resolved.",
    };
  }

  const result = await callScreenedTool(deps, tool, {
    url: requestedUrl,
    ...extraInput,
  });
  if (result.is_error) {
    return {
      tool,
      status: "failure",
      requestedUrl,
      failureKind: classifyToolFailure(result.content),
      message: sanitizeText(result.content),
    };
  }

  const sanitized = sanitizeText(result.content);
  return {
    tool,
    status: "success",
    requestedUrl,
    contentLength: sanitized.length,
    excerpt: buildExcerpt(sanitized),
  };
}

async function callScreenedTool(
  deps: SourceAccessReportDeps,
  tool: SourceAccessReadName,
  input: Parameters<ModuleContext["callTool"]>[1],
): Promise<ToolResult> {
  return getToolMiddleware().execute(
    { name: tool, input },
    () => deps.callTool(tool, input),
  );
}

function classifyToolFailure(content: string): SourceAccessFailureKind {
  if (/playwright.+not installed|cannot find module.+playwright/i.test(content)) {
    return "missing_capability";
  }
  if (/rate[- ]?limit|too many requests/i.test(content)) {
    return "rate_limit";
  }
  if (/timeout|timed out/i.test(content)) {
    return "timeout";
  }
  if (/cloudflare|js \/ cloudflare|checking your browser|enable javascript|js challenge/i.test(content)) {
    return "js_gate";
  }
  if (/auth[- ]?wall|login|log in|authenticated browser profile|storagestatepath|account\/access/i.test(content)) {
    return "auth_wall";
  }
  if (/url is required|must start with http|fully-qualified x\/twitter status url/i.test(content)) {
    return "invalid_input";
  }
  return "tool_error";
}

function sanitizeText(content: string): string {
  return content
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replaceAll(/(authorization:\s*)[^\n\r]+/gi, "$1[redacted]")
    .replaceAll(/(cookie:\s*)[^\n\r]+/gi, "$1[redacted]")
    .replaceAll(/((?:access|auth|refresh|id)_?token=)[^&\s]+/gi, "$1[redacted]")
    .replaceAll(/((?:ct0|auth_token)=)[^&\s]+/gi, "$1[redacted]")
    .replaceAll(/("(?:cookies|origins)"\s*:\s*)\[[\s\S]*?\]/gi, '$1"[redacted]"');
}

function buildExcerpt(content: string): string {
  const compact = content.replaceAll(/\s+/g, " ").trim();
  if (compact.length <= EXCERPT_LIMIT) return compact;
  return `${compact.slice(0, EXCERPT_LIMIT)}...`;
}

function buildNextSteps(
  checks: BrowserSourceAccessReport["checks"],
  renderedArticle: SourceAccessReadResult,
  xPost: SourceAccessReadResult,
): string[] {
  const steps: string[] = [];
  if (!checks.playwright.available) {
    steps.push("Install the optional Playwright peer in the target environment, then rerun this report.");
  }
  if (!checks.storageState.configured) {
    steps.push("Configure modules.browser.storageStatePath to point at an authenticated Playwright storage-state file.");
  } else if (checks.storageState.exists !== true) {
    steps.push("Create or restore the configured storage-state file before relying on authenticated browser reads.");
  }
  if (checks.persistProfile.enabled) {
    steps.push("After capturing a login profile, set modules.browser.persistProfile to false for repeatable read-only reports.");
  }
  for (const read of [renderedArticle, xPost]) {
    if (read.status === "failure") {
      steps.push(`${read.tool} failed with ${read.failureKind}; inspect the typed message and rerun after the capability is fixed.`);
    }
  }
  if (steps.length === 0) {
    steps.push("Attach this report directory to the auth-walled-source unblock precondition.");
  }
  return steps;
}

export function renderReportSummary(report: BrowserSourceAccessReport): string {
  const lines = [
    "# Browser Source-Access Capability Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.overall}`,
    "",
    "## Capability Checks",
    "",
    `- Playwright: ${report.checks.playwright.available ? "available" : "missing"} - ${report.checks.playwright.message}`,
    `- storageStatePath configured: ${String(report.checks.storageState.configured)}`,
    `- storageStatePath file exists: ${String(report.checks.storageState.exists)}`,
    `- persistProfile enabled: ${String(report.checks.persistProfile.enabled)}`,
    "",
    "## Reads",
    "",
    renderReadSummary(report.reads.renderedArticle),
    renderReadSummary(report.reads.xPost),
    "",
    "## Next Steps",
    "",
    ...report.nextSteps.map((step) => `- ${step}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderReadSummary(read: SourceAccessReadResult): string {
  if (read.status === "success") {
    return [
      `- ${read.tool}: success`,
      `  - URL: ${read.requestedUrl}`,
      `  - Sanitized excerpt: ${read.excerpt}`,
    ].join("\n");
  }
  return [
    `- ${read.tool}: ${read.status} (${read.failureKind})`,
    `  - URL: ${read.requestedUrl ?? "not requested"}`,
    `  - Message: ${read.message}`,
  ].join("\n");
}

function renderReportTranscript(report: BrowserSourceAccessReport): string {
  const command = [
    "kota browser source-access-report",
    report.reads.renderedArticle.requestedUrl !== null
      ? `--article-url ${quoteShell(report.reads.renderedArticle.requestedUrl)}`
      : null,
    report.reads.xPost.requestedUrl !== null
      ? `--x-url ${quoteShell(report.reads.xPost.requestedUrl)}`
      : null,
    `--out-dir ${quoteShell(report.outDir)}`,
  ].filter((part): part is string => part !== null).join(" ");
  return [
    `$ ${command}`,
    "",
    renderReportSummary(report),
    "Artifacts:",
    `- ${report.artifacts.jsonPath}`,
    `- ${report.artifacts.summaryPath}`,
    `- ${report.artifacts.transcriptPath}`,
    "",
  ].join("\n");
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
