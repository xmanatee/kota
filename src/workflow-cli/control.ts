import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE } from "../workflow/runtime.js";
import { formatDate, formatDuration, statusIcon } from "./utils.js";

export function registerControlCommands(wfCmd: Command): void {
  wfCmd
    .command("abort")
    .description("Abort the currently active workflow run(s)")
    .action(() => {
      const store = new WorkflowRunStore();
      const state = store.readState();
      const activeRuns = state.activeRuns ?? [];
      if (activeRuns.length === 0) {
        console.log("No active run to abort.");
        return;
      }
      const signalPath = join(store.rootDir, ABORT_SIGNAL_FILE);
      writeFileSync(signalPath, "");
      if (activeRuns.length === 1) {
        console.log(`Abort signal written for run ${activeRuns[0].runId}`);
      } else {
        console.log(`Abort signal written for ${activeRuns.length} active runs:`);
        for (const r of activeRuns) console.log(`  ${r.runId} (${r.workflow})`);
      }
      console.log("The daemon will abort the active run(s) on its next cycle.");
    });

  wfCmd
    .command("pause")
    .description("Pause dispatching new workflow runs (current run completes normally)")
    .action(() => {
      const store = new WorkflowRunStore();
      const pausePath = join(store.rootDir, PAUSE_SIGNAL_FILE);
      if (existsSync(pausePath)) {
        console.log("Dispatch is already paused.");
        return;
      }
      writeFileSync(pausePath, "");
      console.log("Dispatch paused. Run `kota workflow resume` to re-enable.");
    });

  wfCmd
    .command("resume")
    .description("Resume dispatching new workflow runs")
    .action(() => {
      const store = new WorkflowRunStore();
      const pausePath = join(store.rootDir, PAUSE_SIGNAL_FILE);
      if (!existsSync(pausePath)) {
        console.log("Dispatch is not paused.");
        return;
      }
      rmSync(pausePath);
      console.log("Dispatch resumed.");
    });

  wfCmd
    .command("reload")
    .description("Signal the daemon to reload workflow definitions without restarting")
    .action(() => {
      const store = new WorkflowRunStore();
      const reloadPath = join(store.rootDir, RELOAD_SIGNAL_FILE);
      writeFileSync(reloadPath, "");
      console.log("Reload signal written. The daemon will reload definitions on its next cycle.");
    });

  wfCmd
    .command("status")
    .description("Show active run, queue, and per-workflow last-run info")
    .action(() => {
      const store = new WorkflowRunStore();
      const state = store.readState();

      const paused = existsSync(join(store.rootDir, PAUSE_SIGNAL_FILE));
      if (paused) {
        console.log("Dispatch: PAUSED (run `kota workflow resume` to re-enable)");
      }

      const activeRuns = state.activeRuns ?? [];
      const abortPending = existsSync(join(store.rootDir, ABORT_SIGNAL_FILE));
      if (activeRuns.length === 0) {
        console.log("Active run: (none)");
      } else {
        for (const run of activeRuns) {
          console.log(`Active run: ${run.runId}${abortPending ? " (abort pending)" : ""}`);
          console.log(`Workflow:   ${run.workflow}`);
          if (run.startedAt) {
            const elapsed = Date.now() - new Date(run.startedAt).getTime();
            console.log(`Running for: ${formatDuration(elapsed)}`);
          }
        }
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
      if (state.agentBackoff) {
        console.log(
          `Agent backoff:        ${state.agentBackoff.kind} until ${formatDate(state.agentBackoff.until)} (attempt ${state.agentBackoff.failureCount})`,
        );
      }
      if (state.definitionsLoadedAt) {
        console.log(`Definitions loaded:   ${formatDate(state.definitionsLoadedAt)}`);
      }
    });
}
