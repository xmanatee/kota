import type { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";

export function registerGcCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("gc")
    .description(
      "Prune old run artifact directories under .kota/runs/.\n\n" +
      "  Keeps at least --min-keep recent runs per workflow and deletes runs\n" +
      "  older than --retention-days. Active runs are never pruned.\n\n" +
      "  Policy defaults can be set in .kota/config.json under runsGc.",
    )
    .option("--retention-days <n>", "Delete runs older than N days (default: 7)")
    .option("--min-keep <n>", "Always keep at least N recent runs per workflow (default: 10)")
    .option("--dry-run", "Show what would be deleted without deleting anything")
    .action(async (opts: { retentionDays?: string; minKeep?: string; dryRun?: boolean }) => {
      const config = loadConfig();
      const gcConfig = config.runsGc ?? {};

      const retentionDays = opts.retentionDays != null
        ? Number.parseInt(opts.retentionDays, 10)
        : (gcConfig.retentionDays ?? 7);
      const minKeep = opts.minKeep != null
        ? Number.parseInt(opts.minKeep, 10)
        : (gcConfig.minKeepPerWorkflow ?? 10);
      const dryRun = opts.dryRun ?? false;

      if (Number.isNaN(retentionDays) || retentionDays <= 0) {
        console.error("--retention-days must be a positive number");
        process.exit(1);
      }
      if (Number.isNaN(minKeep) || minKeep < 0) {
        console.error("--min-keep must be a non-negative number");
        process.exit(1);
      }

      // Collect active run IDs from the contract so the daemon's in-flight
      // tracker (which may include runs not yet flushed to state) protects
      // them from pruning. The local-side `status()` reads the same persisted
      // state the WorkflowRunStore would, so daemon-down semantics are
      // preserved.
      const status = await ctx.client.workflow.status();
      const protectedRunIds = new Set(status.activeRuns.map((r) => r.runId));

      const store = new WorkflowRunStore();
      const pruned = store.pruneRuns({
        retentionDays,
        minKeepPerWorkflow: minKeep,
        dryRun,
        protectedRunIds,
      });

      if (pruned.length === 0) {
        console.log("Nothing to prune.");
        return;
      }

      const verb = dryRun ? "Would prune" : "Pruned";
      console.log(`${verb} ${pruned.length} run artifact director${pruned.length === 1 ? "y" : "ies"}:`);
      for (const id of pruned) {
        console.log(`  ${id}`);
      }

      if (dryRun) {
        console.log("\n(dry run — nothing was deleted)");
      }
    });
}
