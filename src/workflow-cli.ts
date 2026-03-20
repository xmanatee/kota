import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "./config.js";
import { readOptionalJsonFile } from "./json-file.js";
import { getBuiltinWorkflowDefinitions } from "./workflow/registry.js";
import { getEligibleAtMs } from "./workflow/run-executor.js";
import { WorkflowRunStore } from "./workflow/run-store.js";
import type { WorkflowRunMetadata } from "./workflow/types.js";
import { validateWorkflowDefinitions } from "./workflow/validation.js";
import { buildRunLogs } from "./workflow-logs.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusIcon(status: string): string {
  switch (status) {
    case "success": return "✓";
    case "failed": return "✗";
    case "interrupted": return "⚡";
    case "running": return "▶";
    case "skipped": return "–";
    default: return "?";
  }
}

function listRuns(store: WorkflowRunStore, limit: number): WorkflowRunMetadata[] {
  let dirs: string[];
  try {
    dirs = readdirSync(store.runsDir).sort().reverse();
  } catch {
    return [];
  }
  const runs: WorkflowRunMetadata[] = [];
  for (const dir of dirs) {
    if (runs.length >= limit) break;
    const metadataPath = join(store.runsDir, dir, "metadata.json");
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
    if (metadata) runs.push(metadata);
  }
  return runs;
}

export function registerWorkflowCommands(program: Command): void {
  const wfCmd = program
    .command("workflow")
    .alias("wf")
    .description("Inspect workflow runs and runtime state");

  wfCmd
    .command("list")
    .description("List recent workflow runs")
    .option("-n, --limit <n>", "Number of runs to show", "20")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .action((opts) => {
      const limit = Number.parseInt(opts.limit, 10) || 20;
      const store = new WorkflowRunStore();
      const runs = listRuns(store, limit * 3); // over-fetch to allow filtering
      const filtered = opts.workflow
        ? runs.filter((r) => r.workflow === opts.workflow)
        : runs;
      const page = filtered.slice(0, limit);

      if (page.length === 0) {
        console.log("No runs found.");
        return;
      }

      const idWidth = 42;
      const wfWidth = 12;
      const stWidth = 4;
      const durWidth = 8;
      const costWidth = 8;
      const dateWidth = 18;

      console.log(
        `${"ID".padEnd(idWidth)} ${"Workflow".padEnd(wfWidth)} ${"St".padEnd(stWidth)} ${"Duration".padEnd(durWidth)} ${"Cost".padEnd(costWidth)} ${"Started".padEnd(dateWidth)} Trigger`,
      );
      console.log("-".repeat(120));

      for (const r of page) {
        const id = r.id.padEnd(idWidth);
        const wf = r.workflow.padEnd(wfWidth);
        const st = statusIcon(r.status).padEnd(stWidth);
        const dur = (r.durationMs != null ? formatDuration(r.durationMs) : "…").padEnd(durWidth);
        const cost = (r.totalCostUsd != null ? `$${r.totalCostUsd.toFixed(3)}` : "—").padEnd(costWidth);
        const started = formatDate(r.startedAt).padEnd(dateWidth);
        const trigger = r.trigger.event;
        console.log(`${id} ${wf} ${st} ${dur} ${cost} ${started} ${trigger}`);
      }
    });

  wfCmd
    .command("show <run-id>")
    .description("Show step-level details for a specific run")
    .action((runId) => {
      const store = new WorkflowRunStore();
      // Support prefix matching
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
      const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!metadata) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      const errorPath = join(store.runsDir, resolvedId, "error.txt");
      const errorText = readOptionalJsonFile<never>(errorPath);

      console.log(`Run:      ${metadata.id}`);
      console.log(`Workflow: ${metadata.workflow}`);
      console.log(`Status:   ${statusIcon(metadata.status)} ${metadata.status}`);
      console.log(`Trigger:  ${metadata.trigger.event}`);
      console.log(`Started:  ${new Date(metadata.startedAt).toLocaleString()}`);
      if (metadata.completedAt) {
        console.log(`Finished: ${new Date(metadata.completedAt).toLocaleString()}`);
      }
      if (metadata.durationMs != null) {
        console.log(`Duration: ${formatDuration(metadata.durationMs)}`);
      }
      if (metadata.totalCostUsd != null) {
        console.log(`Cost:     $${metadata.totalCostUsd.toFixed(4)}`);
      }
      if (errorText !== null) {
        console.log(`\nError:\n${errorText}`);
      }

      if (metadata.steps.length > 0) {
        console.log(`\nSteps (${metadata.steps.length}):`);
        for (const step of metadata.steps) {
          const dur = formatDuration(step.durationMs);
          const icon = statusIcon(step.status);
          console.log(`  ${icon} ${step.id} [${step.type}] ${dur}`);
          if (step.error) {
            console.log(`      Error: ${step.error}`);
          }
          if (step.output !== undefined && step.output !== null) {
            const summary = JSON.stringify(step.output);
            const trimmed = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
            console.log(`      Output: ${trimmed}`);
          }
        }
      }
    });

  wfCmd
    .command("logs <run-id>")
    .description("Print agent conversation transcript for a run")
    .option("--step <step-id>", "Show only the named step")
    .action((runId: string, opts: { step?: string }) => {
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
      const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!metadata) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      const stepLogs = buildRunLogs(store.runsDir, resolvedId, metadata, opts.step);

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

  wfCmd
    .command("trigger <name>")
    .description("Manually enqueue a workflow run")
    .option("--force", "Ignore cooldown and enqueue immediately")
    .action((name: string, opts: { force?: boolean }) => {
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

      const notBeforeMs = opts.force ? now : eligibleAtMs;
      const trigger = { event: "manual", payload: { triggeredAt: new Date().toISOString() } };
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
      if (state.activeRunId) {
        console.log("Daemon is busy — run will start after current run finishes.");
      }
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

  wfCmd
    .command("status")
    .description("Show active run, queue, and per-workflow last-run info")
    .action(() => {
      const store = new WorkflowRunStore();
      const state = store.readState();

      if (state.activeRunId) {
        console.log(`Active run: ${state.activeRunId}`);
        console.log(`Workflow:   ${state.activeWorkflow}`);
        if (state.activeStartedAt) {
          const elapsed = Date.now() - new Date(state.activeStartedAt).getTime();
          console.log(`Running for: ${formatDuration(elapsed)}`);
        }
      } else {
        console.log("Active run: (none)");
      }

      console.log();
      if (state.pendingRuns.length === 0) {
        console.log("Queue: empty");
      } else {
        console.log(`Queue (${state.pendingRuns.length}):`);
        for (const q of state.pendingRuns) {
          const notBefore = q.notBeforeMs > Date.now()
            ? ` (not before ${new Date(q.notBeforeMs).toLocaleTimeString()})`
            : "";
          console.log(`  • ${q.workflowName} — ${q.trigger.event}${notBefore}`);
        }
      }

      const wfNames = Object.keys(state.workflows);
      if (wfNames.length > 0) {
        console.log();
        console.log("Per-workflow last run:");
        const nameWidth = Math.max(...wfNames.map((n) => n.length), 10);
        const hasScheduled = wfNames.some((n) => state.workflows[n].nextScheduledAt);
        const schedWidth = 22;
        const header = hasScheduled
          ? `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} ${"Next Run".padEnd(schedWidth)} Last Run ID`
          : `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} Last Run ID`;
        const sepLen = nameWidth + 12 + 22 + (hasScheduled ? schedWidth + 1 : 0) + 42 + 4;
        console.log(header);
        console.log(`  ${"-".repeat(sepLen)}`);
        for (const name of wfNames) {
          const wf = state.workflows[name];
          const st = wf.lastStatus ? `${statusIcon(wf.lastStatus)} ${wf.lastStatus}` : "(none)";
          const completed = wf.lastCompletedAt ? formatDate(wf.lastCompletedAt) : "(none)";
          const runId = wf.lastRunId || "(none)";
          if (hasScheduled) {
            const nextRun = wf.nextScheduledAt ? formatDate(wf.nextScheduledAt) : "(none)";
            console.log(
              `  ${name.padEnd(nameWidth)} ${st.padEnd(12)} ${completed.padEnd(22)} ${nextRun.padEnd(schedWidth)} ${runId}`,
            );
          } else {
            console.log(
              `  ${name.padEnd(nameWidth)} ${st.padEnd(12)} ${completed.padEnd(22)} ${runId}`,
            );
          }
        }
      }

      const config = loadConfig();
      const dailySpend = store.getDailySpendUsd();
      const dailyBudget = config.dailyBudgetUsd;

      console.log();
      console.log(`Total completed runs: ${state.completedRuns}`);
      if (state.totalCostUsd != null) {
        console.log(`Total cost:           $${state.totalCostUsd.toFixed(4)}`);
      }
      if (dailyBudget != null) {
        const budgetStatus = dailySpend >= dailyBudget ? " ⚠ budget reached" : "";
        console.log(`Today's spend:        $${dailySpend.toFixed(4)} / $${dailyBudget.toFixed(4)}${budgetStatus}`);
      } else if (dailySpend > 0) {
        console.log(`Today's spend:        $${dailySpend.toFixed(4)}`);
      }
    });
}
