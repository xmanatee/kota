import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "./json-file.js";
import { WorkflowRunStore } from "./workflow/run-store.js";
import type { WorkflowRunMetadata } from "./workflow/types.js";

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
      const dateWidth = 18;

      console.log(
        `${"ID".padEnd(idWidth)} ${"Workflow".padEnd(wfWidth)} ${"St".padEnd(stWidth)} ${"Duration".padEnd(durWidth)} ${"Started".padEnd(dateWidth)} Trigger`,
      );
      console.log("-".repeat(110));

      for (const r of page) {
        const id = r.id.padEnd(idWidth);
        const wf = r.workflow.padEnd(wfWidth);
        const st = statusIcon(r.status).padEnd(stWidth);
        const dur = (r.durationMs != null ? formatDuration(r.durationMs) : "…").padEnd(durWidth);
        const started = formatDate(r.startedAt).padEnd(dateWidth);
        const trigger = r.trigger.event;
        console.log(`${id} ${wf} ${st} ${dur} ${started} ${trigger}`);
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
        console.log(
          `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} Last Run ID`,
        );
        console.log(`  ${"-".repeat(nameWidth + 12 + 22 + 42 + 4)}`);
        for (const name of wfNames) {
          const wf = state.workflows[name];
          const st = wf.lastStatus ? `${statusIcon(wf.lastStatus)} ${wf.lastStatus}` : "(none)";
          const completed = wf.lastCompletedAt ? formatDate(wf.lastCompletedAt) : "(none)";
          const runId = wf.lastRunId || "(none)";
          console.log(
            `  ${name.padEnd(nameWidth)} ${st.padEnd(12)} ${completed.padEnd(22)} ${runId}`,
          );
        }
      }

      console.log();
      console.log(`Total completed runs: ${state.completedRuns}`);
    });
}
