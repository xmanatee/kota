import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { buildRunLogs, filterWithContext, followRunLogs, stepBanner } from "./workflow-logs.js";

export function registerLogsCommand(wfCmd: Command): void {
  wfCmd
    .command("logs [run-id]")
    .description("Print agent conversation transcript for a run")
    .option("--step <step-id>", "Show only the named step")
    .option("-f, --follow", "Stream output for the active run in real time (500 ms poll)")
    .option("--grep <pattern>", "Filter output to lines matching pattern (substring by default)")
    .option("--regex", "Treat --grep pattern as a regular expression")
    .option("-C, --context <n>", "Lines of context around each --grep match (default: 3)")
    .action(async (runId: string | undefined, opts: { step?: string; follow?: boolean; grep?: string; regex?: boolean; context?: string }) => {
      const store = new WorkflowRunStore();

      if (!runId && !opts.follow) {
        print(line(span("Specify a run ID or use --follow to stream the active run.", "error")));
        process.exit(1);
      }

      let resolvedId: string | undefined;
      if (runId) {
        if (!runId.includes("Z-")) {
          try {
            const dirs = readdirSync(store.runsDir).sort().reverse();
            const match = dirs.find((d) => d.startsWith(runId));
            if (!match) {
              print(line(span(`Run "${runId}" not found.`, "error")));
              process.exit(1);
            }
            resolvedId = match;
          } catch {
            print(line(span(`Run "${runId}" not found.`, "error")));
            process.exit(1);
          }
        } else {
          resolvedId = runId;
        }
      }

      if (opts.follow) {
        await followRunLogs(store.runsDir, store.statePath, resolvedId, opts.step);
        return;
      }

      const metadataPath = join(store.runsDir, resolvedId!, "metadata.json");
      const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!metadata) {
        print(line(span(`Run "${resolvedId}" not found.`, "error")));
        process.exit(1);
      }

      const grepPattern = opts.grep;
      const isRegex = !!opts.regex;
      const contextN = Math.max(0, Number.parseInt(opts.context ?? "3", 10) || 0);

      const rawLogs = buildRunLogs(store.runsDir, resolvedId!, metadata, opts.step);
      const stepLogs = grepPattern
        ? rawLogs.map(({ stepId, lines }) => ({
            stepId,
            lines: filterWithContext(lines, grepPattern, isRegex, contextN),
          }))
        : rawLogs;

      if (stepLogs.length === 0) {
        print(line(plain(
          opts.step
            ? `No agent step "${opts.step}" found in run "${resolvedId}".`
            : "No agent steps in this run.",
        )));
        return;
      }

      for (const { stepId, lines } of stepLogs) {
        const nodes = [
          line(plain("")),
          line(plain(stepBanner(stepId))),
        ];
        if (lines.length === 0) {
          nodes.push(line(plain(grepPattern ? "  (no matching lines)" : "  (no events)")));
        } else {
          for (const l of lines) nodes.push(line(plain(l)));
        }
        print(stack(...nodes));
      }
    });
}
