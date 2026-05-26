import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { executeTool } from "#core/tools/index.js";
import { isPlaywrightAvailable } from "./lifecycle.js";
import {
  defaultSourceAccessReportOptions,
  runSourceAccessReport,
} from "./source-access-report.js";

export function buildBrowserCommand(ctx: ModuleContext): Command {
  const command = new Command("browser").description(
    "Inspect and exercise browser-module capabilities.",
  );

  command
    .command("source-access-report")
    .description(
      "Write a redacted source-access capability report for rendered/auth-walled research sources.",
    )
    .option("--article-url <url>", "JS-rendered article URL to read with rendered_article_read")
    .option("--x-url <url>", "X/Twitter status URL to read with x_post_read")
    .option("--article-selector <selector>", "Optional selector for rendered_article_read")
    .option("--timeout-ms <ms>", "Per-read timeout in milliseconds", "30000")
    .option("--run-id <id>", "Run id under .kota/runs/ for report artifacts")
    .option("--out-dir <dir>", "Explicit artifact directory; overrides --run-id")
    .action(
      async (opts: {
        articleUrl?: string;
        xUrl?: string;
        articleSelector?: string;
        timeoutMs: string;
        runId?: string;
        outDir?: string;
      }) => {
        const timeoutMs = parsePositiveInteger(opts.timeoutMs, "timeout-ms");
        const runtimeConfig = loadConfig(ctx.cwd);
        const runtimeLoader = await loadRuntimeModules({
          config: runtimeConfig,
          cwd: ctx.cwd,
        });
        const defaults = defaultSourceAccessReportOptions(ctx.cwd);
        try {
          const result = await runSourceAccessReport(
            {
              ...defaults,
              config: runtimeConfig.modules?.browser,
              articleUrl: opts.articleUrl ?? null,
              xPostUrl: opts.xUrl ?? null,
              articleSelector: opts.articleSelector ?? null,
              timeoutMs,
              runId: opts.runId ?? null,
              outDir: opts.outDir ?? null,
            },
            {
              isPlaywrightAvailable: () => isPlaywrightAvailable(ctx.cwd),
              callTool: executeTool,
              now: () => new Date(),
            },
          );
          process.stdout.write(result.transcript);
        } finally {
          await runtimeLoader.unloadAll();
        }
      },
    );

  return command;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer, got "${value}".`);
  }
  return parsed;
}
