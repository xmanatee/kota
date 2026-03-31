import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { DaemonControlClient } from "../server/daemon-client.js";
import { getBuiltinWorkflowDefinitions } from "../workflow/registry.js";
import { getEligibleAtMs } from "../workflow/run-executor-utils.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/run-types.js";
import { validateWorkflowDefinitions } from "../workflow/validation.js";

export function registerTriggerCommands(wfCmd: Command): void {
  wfCmd
    .command("trigger <name>")
    .description("Manually enqueue a workflow run")
    .option("--force", "Ignore cooldown and enqueue immediately")
    .option("--tag <tag>", "Attach a tag to this run (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
    .action(async (name: string, opts: { force?: boolean; tag: string[] }) => {
      const store = new WorkflowRunStore();
      const definitions = validateWorkflowDefinitions(
        getBuiltinWorkflowDefinitions(),
        process.cwd(),
      );

      const definition = definitions.find((d) => d.name === name);
      if (!definition) {
        const names = definitions.map((d) => d.name).join(", ");
        console.error(`Unknown workflow "${name}". Available: ${names}`);
        process.exit(1);
      }

      if (!definition.enabled) {
        console.error(`Workflow "${name}" is disabled.`);
        process.exit(1);
      }

      const state = store.readState();

      const alreadyQueued = state.pendingRuns.some(
        (r) => r.workflowName === name,
      );
      if (alreadyQueued) {
        console.error(`Workflow "${name}" is already queued.`);
        process.exit(1);
      }

      const cooldownMs = definition.triggers[0]?.cooldownMs ?? 0;
      const eligibleAtMs = getEligibleAtMs(name, cooldownMs, state);
      const now = Date.now();

      if (eligibleAtMs > now && !opts.force) {
        const remaining = Math.ceil((eligibleAtMs - now) / 1000);
        console.error(
          `Workflow "${name}" is in cooldown (${remaining}s remaining). Use --force to override.`,
        );
        process.exit(1);
      }

      const tags = opts.tag.length > 0 ? opts.tag : undefined;

      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.trigger(name, tags);
        if (result) {
          if (result.alreadyQueued) {
            console.error(`Workflow "${name}" is already queued.`);
            process.exit(1);
          }
          console.log(`Queued workflow "${name}".`);
          return;
        }
      }

      const notBeforeMs = opts.force ? now : eligibleAtMs;
      const trigger = {
        event: "manual",
        payload: {
          triggeredAt: new Date().toISOString(),
          ...(tags !== undefined && { tags }),
        },
      };
      state.pendingRuns = [
        ...state.pendingRuns,
        {
          workflowName: name,
          trigger,
          enqueuedAtMs: now,
          notBeforeMs,
        },
      ];
      store.setPendingRuns(state.pendingRuns);

      const notBeforeStr = notBeforeMs > now
        ? ` (eligible at ${new Date(notBeforeMs).toLocaleTimeString()})`
        : "";
      console.log(`Queued workflow "${name}"${notBeforeStr}.`);
      if (state.activeRuns && state.activeRuns.length > 0) {
        console.log("Daemon is busy — run will start after current run finishes.");
      }
    });

  wfCmd
    .command("retry <run-id>")
    .description("Retry a failed workflow run, replaying successful steps and re-executing from the first failure")
    .action((runId: string) => {
      const store = new WorkflowRunStore();

      let resolvedId = runId;
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
      }

      const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
      const original = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!original) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      if (original.status === "running") {
        console.error(`Run "${resolvedId}" is still running. Cannot retry an active run.`);
        process.exit(1);
      }

      if (original.status === "success" || original.status === "completed-with-warnings") {
        console.error(`Run "${resolvedId}" completed successfully. Nothing to retry.`);
        process.exit(1);
      }

      const definitions = validateWorkflowDefinitions(
        getBuiltinWorkflowDefinitions(),
        process.cwd(),
      );
      const definition = definitions.find((d) => d.name === original.workflow);
      if (!definition) {
        console.error(`Workflow "${original.workflow}" is no longer defined.`);
        process.exit(1);
      }

      const state = store.readState();
      const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === original.workflow);
      if (alreadyQueued) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }

      const now = Date.now();
      const trigger = {
        event: "retry",
        payload: { retryOf: resolvedId, triggeredAt: new Date().toISOString() },
      };
      state.pendingRuns = [
        ...state.pendingRuns,
        { workflowName: original.workflow, trigger, enqueuedAtMs: now, notBeforeMs: now },
      ];
      store.setPendingRuns(state.pendingRuns);
      console.log(`Queued retry of "${original.workflow}" (original run: ${resolvedId}).`);
    });

  wfCmd
    .command("prune")
    .description("Remove old workflow run directories")
    .option("--days <n>", "Delete runs older than N days", "7")
    .option("--min-keep <n>", "Keep at least N runs per workflow", "10")
    .option("--dry-run", "Show what would be deleted without deleting")
    .action((opts: { days: string; minKeep: string; dryRun?: boolean }) => {
      const retentionDays = Number.parseInt(opts.days, 10) || 7;
      const minKeepPerWorkflow = Number.parseInt(opts.minKeep, 10) || 10;
      const store = new WorkflowRunStore();
      const deleted = store.pruneRuns({ retentionDays, minKeepPerWorkflow, dryRun: opts.dryRun });
      if (deleted.length === 0) {
        console.log(opts.dryRun ? "Nothing to prune." : "Nothing pruned.");
      } else if (opts.dryRun) {
        console.log(`Would delete ${deleted.length} run director${deleted.length === 1 ? "y" : "ies"}:`);
        for (const id of deleted) console.log(`  ${id}`);
      } else {
        console.log(`Pruned ${deleted.length} run director${deleted.length === 1 ? "y" : "ies"}.`);
      }
    });
}
