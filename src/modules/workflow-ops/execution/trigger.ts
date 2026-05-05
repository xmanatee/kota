import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { getEligibleAtMs } from "#core/workflow/run-executor-utils.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { formatRunId } from "#core/workflow/run-store-helpers.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowGetRunResult } from "../client.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";

/**
 * Resolve a run-id prefix against the on-disk run directories. The CLI
 * accepts short prefixes (`builder-9pekjj`) and full timestamped ids; this
 * resolution stays local because run-id prefix lookup walks `.kota/runs/`,
 * which the contract does not expose.
 */
function resolveRunIdOrExit(store: WorkflowRunStore, runId: string): string {
  if (runId.includes("Z-")) return runId;
  try {
    const dirs = readdirSync(store.runsDir).sort().reverse();
    const match = dirs.find((d) => d.startsWith(runId));
    if (!match) {
      console.error(`Run "${runId}" not found.`);
      process.exit(1);
    }
    return match;
  } catch {
    console.error(`Run "${runId}" not found.`);
    process.exit(1);
  }
}

export function registerTriggerCommands(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("trigger <name>")
    .description("Manually enqueue a workflow run")
    .option("--force", "Ignore cooldown and enqueue immediately")
    .option("--tag <tag>", "Attach a tag to this run (repeatable)", (val, prev: string[]) => [...prev, val], [] as string[])
    .option("--payload <json>", "Extra JSON fields to merge into the trigger payload")
    .action(async (name: string, opts: { force?: boolean; tag: string[]; payload?: string }) => {
      let extraPayload: Record<string, unknown> | undefined;
      if (opts.payload !== undefined) {
        try {
          const parsed: unknown = JSON.parse(opts.payload);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("payload must be a JSON object");
          }
          extraPayload = parsed as Record<string, unknown>;
        } catch (err) {
          console.error(`Invalid --payload JSON: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      const definitions = getValidatedWorkflowDefinitions(ctx);
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

      const status = await ctx.client.workflow.status();
      const cooldownMs = definition.triggers[0]?.cooldownMs ?? 0;
      const eligibleAtMs = getEligibleAtMs(name, cooldownMs, status);
      const now = Date.now();
      if (eligibleAtMs > now && !opts.force) {
        const remaining = Math.ceil((eligibleAtMs - now) / 1000);
        console.error(
          `Workflow "${name}" is in cooldown (${remaining}s remaining). Use --force to override.`,
        );
        process.exit(1);
      }

      const tags = opts.tag.length > 0 ? opts.tag : undefined;
      const result = await ctx.client.workflow.triggerByName(name, {
        ...(tags !== undefined && { tags }),
        ...(extraPayload !== undefined && { payload: extraPayload }),
        ...(opts.force === true && { force: true }),
        notBeforeMs: opts.force ? now : eligibleAtMs,
      });
      if (!result.ok) {
        console.error(`Workflow "${name}" is already queued.`);
        process.exit(1);
      }
      const notBefore = !opts.force && eligibleAtMs > now
        ? ` (eligible at ${new Date(eligibleAtMs).toLocaleTimeString()})`
        : "";
      console.log(`Queued workflow "${name}"${notBefore}.`);
      if (result.path === "queue" && status.activeRuns.length > 0) {
        console.log("Daemon is busy — run will start after current run finishes.");
      }
    });

  wfCmd
    .command("retry <run-id>")
    .description("Retry a failed workflow run, replaying successful steps and re-executing from the first failure")
    .action(async (runId: string) => {
      const store = new WorkflowRunStore();
      const resolvedId = resolveRunIdOrExit(store, runId);

      const original = await loadRunOrExit(ctx, store, resolvedId);

      if (original.status === "running") {
        console.error(`Run "${resolvedId}" is still running. Cannot retry an active run.`);
        process.exit(1);
      }

      if (original.status === "success" || original.status === "completed-with-warnings") {
        console.error(`Run "${resolvedId}" completed successfully. Nothing to retry.`);
        process.exit(1);
      }

      const definitions = getValidatedWorkflowDefinitions(ctx);
      const definition = definitions.find((d) => d.name === original.workflow);
      if (!definition) {
        console.error(`Workflow "${original.workflow}" is no longer defined.`);
        process.exit(1);
      }

      const result = await ctx.client.workflow.triggerByName(original.workflow, {
        event: "retry",
        payload: { retryOf: resolvedId },
      });
      if (!result.ok) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }
      console.log(`Queued retry of "${original.workflow}" (original run: ${resolvedId}).`);
    });

  wfCmd
    .command("replay <run-id>")
    .description("Replay a completed workflow run using its original trigger payload")
    .action(async (runId: string) => {
      const store = new WorkflowRunStore();
      const resolvedId = resolveRunIdOrExit(store, runId);

      const original = await loadRunOrExit(ctx, store, resolvedId);

      if (original.status === "running") {
        console.error(`Run "${resolvedId}" is still running. Cannot replay an active run.`);
        process.exit(1);
      }

      const definitions = getValidatedWorkflowDefinitions(ctx);
      const definition = definitions.find((d) => d.name === original.workflow);
      if (!definition) {
        console.error(`Workflow "${original.workflow}" is no longer defined.`);
        process.exit(1);
      }
      if (!definition.enabled) {
        console.error(`Workflow "${original.workflow}" is disabled.`);
        process.exit(1);
      }

      const originalPayload = typeof original.triggerPayload === "object" && original.triggerPayload !== null
        ? (original.triggerPayload as Record<string, unknown>)
        : {};
      const { _runId: _discarded, ...cleanPayload } = originalPayload as Record<string, unknown> & { _runId?: unknown };

      const newRunId = formatRunId(original.workflow);
      const result = await ctx.client.workflow.triggerByName(original.workflow, {
        event: "workflow.replay",
        runId: newRunId,
        payload: {
          ...cleanPayload,
          replayOf: resolvedId,
          replayTriggeredAt: new Date().toISOString(),
        },
      });
      if (!result.ok) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }
      console.log(`Replaying "${original.workflow}" (original: ${resolvedId}).`);
      const reportedId = result.runId ?? newRunId;
      if (reportedId !== original.workflow) console.log(`New run ID: ${reportedId}`);
    });

  wfCmd
    .command("resume-run <run-id>")
    .description("Resume a failed workflow run from a specific step, reusing prior step outputs")
    .requiredOption("--from-step <step-id>", "Step ID to resume execution from")
    .action(async (runId: string, opts: { fromStep: string }) => {
      const store = new WorkflowRunStore();
      const resolvedId = resolveRunIdOrExit(store, runId);

      const original = store.getRun(resolvedId);
      if (!original) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      if (original.status === "running") {
        console.error(`Run "${resolvedId}" is still active. Cannot resume a running run.`);
        process.exit(1);
      }

      if (original.status === "success") {
        console.error(`Run "${resolvedId}" completed successfully. Use "replay" to re-execute from the beginning.`);
        process.exit(1);
      }

      const definitions = getValidatedWorkflowDefinitions(ctx);
      const definition = definitions.find((d) => d.name === original.workflow);
      if (!definition) {
        console.error(`Workflow "${original.workflow}" is no longer defined.`);
        process.exit(1);
      }

      const stepIdx = definition.steps.findIndex((s) => s.id === opts.fromStep);
      if (stepIdx === -1) {
        const stepIds = definition.steps.map((s) => s.id).join(", ");
        console.error(`Step "${opts.fromStep}" not found in workflow "${original.workflow}". Available steps: ${stepIds}`);
        process.exit(1);
      }

      for (let i = 0; i < stepIdx; i++) {
        const defStep = definition.steps[i]!;
        const result = original.steps.find((s) => s.id === defStep.id);
        if (!result || result.status !== "success") {
          console.error(
            `Cannot resume from step "${opts.fromStep}": prerequisite step "${defStep.id}" did not complete successfully in run "${resolvedId}".`,
          );
          process.exit(1);
        }
      }

      const newRunId = formatRunId(original.workflow);
      const result = await ctx.client.workflow.triggerByName(original.workflow, {
        event: "resume",
        runId: newRunId,
        payload: {
          resumedFromRunId: resolvedId,
          resumeFromStep: opts.fromStep,
          resumeTriggeredAt: new Date().toISOString(),
        },
      });
      if (!result.ok) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }
      console.log(`Resuming "${original.workflow}" from step "${opts.fromStep}" (source: ${resolvedId}).`);
      const reportedId = result.runId ?? newRunId;
      if (reportedId !== original.workflow) console.log(`New run ID: ${reportedId}`);
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

/**
 * Load a run's metadata via the contract first (so the daemon-up path picks
 * up live state for an in-flight run) and fall back to the on-disk artifact.
 * Used by `retry`/`replay` since both need `triggerPayload` for cleanup.
 */
async function loadRunOrExit(
  ctx: ModuleContext,
  store: WorkflowRunStore,
  resolvedId: string,
): Promise<{
  workflow: string;
  status: string;
  triggerPayload: Record<string, unknown>;
}> {
  const result: WorkflowGetRunResult = await ctx.client.workflow.getRun(resolvedId);
  if (result.found) {
    return {
      workflow: result.run.workflow,
      status: result.run.status,
      triggerPayload: result.run.triggerPayload ?? {},
    };
  }
  // Fall back to direct disk read — the contract returns `not found` when the
  // daemon doesn't track the run; the artifact may still exist.
  const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
  if (!metadata) {
    console.error(`Run "${resolvedId}" not found.`);
    process.exit(1);
  }
  return {
    workflow: metadata.workflow,
    status: metadata.status,
    triggerPayload:
      typeof metadata.trigger?.payload === "object" && metadata.trigger.payload !== null
        ? (metadata.trigger.payload as Record<string, unknown>)
        : {},
  };
}
