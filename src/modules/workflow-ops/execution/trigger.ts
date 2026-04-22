import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { getEligibleAtMs } from "#core/workflow/run-executor-utils.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { formatRunId } from "#core/workflow/run-store-helpers.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { getWorkflowDefinitions } from "../definitions-source.js";

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

      const store = new WorkflowRunStore();
      const definitions = validateWorkflowDefinitions(
        getWorkflowDefinitions(ctx),
        process.cwd(),
        { defaultAgentHarness: ctx.config.defaultAgentHarness },
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
        const result = await client.trigger(name, tags, extraPayload);
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
          ...(extraPayload ?? {}),
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
        getWorkflowDefinitions(ctx),
        process.cwd(),
        { defaultAgentHarness: ctx.config.defaultAgentHarness },
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
    .command("replay <run-id>")
    .description("Replay a completed workflow run using its original trigger payload")
    .action(async (runId: string) => {
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

      const original = store.getRun(resolvedId);
      if (!original) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      if (original.status === "running") {
        console.error(`Run "${resolvedId}" is still running. Cannot replay an active run.`);
        process.exit(1);
      }

      const definitions = validateWorkflowDefinitions(
        getWorkflowDefinitions(ctx),
        process.cwd(),
        { defaultAgentHarness: ctx.config.defaultAgentHarness },
      );
      const definition = definitions.find((d) => d.name === original.workflow);
      if (!definition) {
        console.error(`Workflow "${original.workflow}" is no longer defined.`);
        process.exit(1);
      }

      if (!definition.enabled) {
        console.error(`Workflow "${original.workflow}" is disabled.`);
        process.exit(1);
      }

      const state = store.readState();
      const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === original.workflow);
      if (alreadyQueued) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }

      const now = Date.now();
      const originalPayload = typeof original.trigger?.payload === "object" && original.trigger.payload !== null
        ? (original.trigger.payload as Record<string, unknown>)
        : {};
      const { _runId: _discarded, ...cleanPayload } = originalPayload as Record<string, unknown> & { _runId?: unknown };

      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.trigger(original.workflow, undefined, {
          ...cleanPayload,
          replayOf: resolvedId,
          replayTriggeredAt: new Date().toISOString(),
        });
        if (result) {
          if (result.alreadyQueued) {
            console.error(`Workflow "${original.workflow}" is already queued.`);
            process.exit(1);
          }
          const newRunId = result.queued ?? original.workflow;
          console.log(`Replaying "${original.workflow}" (original: ${resolvedId}).`);
          if (newRunId !== original.workflow) console.log(`New run ID: ${newRunId}`);
          return;
        }
      }

      const runId2 = formatRunId(original.workflow);
      const trigger = {
        event: "workflow.replay",
        payload: {
          ...cleanPayload,
          replayOf: resolvedId,
          replayTriggeredAt: new Date().toISOString(),
          _runId: runId2,
        },
      };
      store.setPendingRuns([
        ...state.pendingRuns,
        { runId: runId2, workflowName: original.workflow, trigger, enqueuedAtMs: now, notBeforeMs: now },
      ]);
      console.log(`Replaying "${original.workflow}" (original: ${resolvedId}).`);
      console.log(`New run ID: ${runId2}`);
    });

  wfCmd
    .command("resume-run <run-id>")
    .description("Resume a failed workflow run from a specific step, reusing prior step outputs")
    .requiredOption("--from-step <step-id>", "Step ID to resume execution from")
    .action(async (runId: string, opts: { fromStep: string }) => {
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

      const definitions = validateWorkflowDefinitions(
        getWorkflowDefinitions(ctx),
        process.cwd(),
        { defaultAgentHarness: ctx.config.defaultAgentHarness },
      );
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

      const state = store.readState();
      const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === original.workflow);
      if (alreadyQueued) {
        console.error(`Workflow "${original.workflow}" is already queued.`);
        process.exit(1);
      }

      const now = Date.now();
      const resumePayload = {
        resumedFromRunId: resolvedId,
        resumeFromStep: opts.fromStep,
        resumeTriggeredAt: new Date().toISOString(),
      };

      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.trigger(original.workflow, undefined, resumePayload);
        if (result) {
          if (result.alreadyQueued) {
            console.error(`Workflow "${original.workflow}" is already queued.`);
            process.exit(1);
          }
          console.log(`Resuming "${original.workflow}" from step "${opts.fromStep}" (source: ${resolvedId}).`);
          if (result.queued && result.queued !== original.workflow) console.log(`New run ID: ${result.queued}`);
          return;
        }
      }

      const runId2 = formatRunId(original.workflow);
      const trigger = {
        event: "resume",
        payload: { ...resumePayload, _runId: runId2 },
      };
      store.setPendingRuns([
        ...state.pendingRuns,
        { runId: runId2, workflowName: original.workflow, trigger, enqueuedAtMs: now, notBeforeMs: now },
      ]);
      console.log(`Resuming "${original.workflow}" from step "${opts.fromStep}" (source: ${resolvedId}).`);
      console.log(`New run ID: ${runId2}`);
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
