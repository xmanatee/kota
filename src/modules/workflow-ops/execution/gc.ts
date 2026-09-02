import type { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  defaultWorkflowRunRetentionDays,
  WorkflowRunStore,
} from "#core/workflow/run-store.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import { resolveWorkflowRunPruneAuthority } from "./prune-authority.js";

export function registerGcCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("gc")
    .description(
      "Prune old run artifact directories under .kota/runs/.\n\n" +
      "  Keeps at least --min-keep recent runs per workflow and deletes runs\n" +
      "  older than --retention-days. Active runs are never pruned.\n\n" +
      "  Policy defaults can be set in .kota/config.json under runsGc.",
    )
    .option("--retention-days <n>", "Delete runs older than N days")
    .option("--min-keep <n>", "Always keep at least N recent runs per workflow (default: 10)")
    .option("--dry-run", "Show what would be deleted without deleting anything")
    .action(async (opts: { retentionDays?: string; minKeep?: string; dryRun?: boolean }) => {
      const config = loadConfig();
      const gcConfig = config.runsGc ?? {};

      const retentionDays = opts.retentionDays != null
        ? Number.parseInt(opts.retentionDays, 10)
        : (gcConfig.retentionDays ?? defaultWorkflowRunRetentionDays());
      const minKeep = opts.minKeep != null
        ? Number.parseInt(opts.minKeep, 10)
        : (gcConfig.minKeepPerWorkflow ?? 10);
      const dryRun = opts.dryRun ?? false;

      if (Number.isNaN(retentionDays) || retentionDays <= 0) {
        printWorkflowError("--retention-days must be a positive number");
        process.exit(1);
      }
      if (Number.isNaN(minKeep) || minKeep < 0) {
        printWorkflowError("--min-keep must be a non-negative number");
        process.exit(1);
      }

      // Combine daemon in-flight handles with canonical durable state. Queued
      // runs need protection before metadata exists; every other non-terminal
      // state must also decode strictly before destructive enumeration.
      const status = await ctx.client.workflow.status();
      const store = new WorkflowRunStore(ctx.cwd);
      const {
        protectedRunIds,
        authorityCriticalRunIds,
        operationallyActiveRunIds,
        terminalRunIds,
      } =
        resolveWorkflowRunPruneAuthority({
          liveRunIds: status.activeRuns.map((run) => run.runId),
          protectedRunIds: status.protectedRunIds,
          authorityCriticalRunIds: status.authorityCriticalRunIds,
          operationallyActiveRunIds: status.operationallyActiveRunIds,
          terminalRunIds: status.terminalRunIds,
        });
      const pruned = store.pruneRuns({
        retentionDays,
        minKeepPerWorkflow: minKeep,
        dryRun,
        protectedRunIds,
        authorityCriticalRunIds,
        operationallyActiveRunIds,
        terminalRunIds,
      });

      if (pruned.length === 0) {
        printWorkflowText("Nothing to prune.");
        return;
      }

      const verb = dryRun ? "Would prune" : "Pruned";
      printWorkflowText(`${verb} ${pruned.length} run artifact director${pruned.length === 1 ? "y" : "ies"}:`);
      for (const id of pruned) {
        printWorkflowText(`  ${id}`);
      }

      if (dryRun) {
        printWorkflowText("\n(dry run — nothing was deleted)");
      }
    });
}
