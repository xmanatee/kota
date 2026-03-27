import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/run-types.js";
import { buildRunLogs, followRunLogs } from "../workflow-logs.js";

export function registerLogsCommand(wfCmd: Command): void {
  wfCmd
    .command("logs [run-id]")
    .description("Print agent conversation transcript for a run")
    .option("--step <step-id>", "Show only the named step")
    .option("-f, --follow", "Stream output for the active run in real time (500 ms poll)")
    .action(async (runId: string | undefined, opts: { step?: string; follow?: boolean }) => {
      const store = new WorkflowRunStore();

      if (!runId && !opts.follow) {
        console.error("Specify a run ID or use --follow to stream the active run.");
        process.exit(1);
      }

      let resolvedId: string | undefined;
      if (runId) {
        if (!runId.includes("Z-")) {
          try {
            const dirs = readdirSync(store.runsDir).sort().reverse();
            const match = dirs.find((d) => d.startsWith(runId));
            if (!match) {
              console.error(`Run "${runId}" not found.`);
              process.exit(1);
            }
            resolvedId = match;
          } catch {
            console.error(`Run "${runId}" not found.`);
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
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      const stepLogs = buildRunLogs(store.runsDir, resolvedId!, metadata, opts.step);

      if (stepLogs.length === 0) {
        console.log(opts.step
          ? `No agent step "${opts.step}" found in run "${resolvedId}".`
          : "No agent steps in this run.");
        return;
      }

      for (const { stepId, lines } of stepLogs) {
        console.log(`\n── Step: ${stepId} ${"─".repeat(Math.max(0, 60 - stepId.length))}`);
        if (lines.length === 0) {
          console.log("  (no events)");
        } else {
          for (const line of lines) console.log(line);
        }
      }
    });
}
