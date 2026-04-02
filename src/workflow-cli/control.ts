import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { DaemonControlClient } from "../server/daemon-client.js";
import { isWithinDispatchWindow, msUntilDispatchWindowOpens } from "../workflow/dispatch-window.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import { ABORT_SIGNAL_FILE, PAUSE_SIGNAL_FILE, RELOAD_SIGNAL_FILE } from "../workflow/runtime.js";
import { formatDate, formatDuration, statusIcon } from "./utils.js";

export function registerControlCommands(wfCmd: Command): void {
  wfCmd
    .command("abort")
    .description("Abort the currently active workflow run(s)")
    .action(async () => {
      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.abort();
        if (result) {
          if (result.aborted === 0) {
            console.log("No active run to abort.");
          } else {
            console.log(`Aborted ${result.aborted} active run(s).`);
          }
          return;
        }
      }
      // Daemon not reachable — fall back to signal file
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
    .command("cancel <run-id>")
    .description("Cancel a queued (pending) workflow run before it starts")
    .action(async (runId: string) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("No running daemon found. Cannot cancel a queued run without a daemon.");
        process.exit(1);
      }
      const result = await client.cancelRun(runId);
      if (!result) {
        console.error("Failed to reach daemon.");
        process.exit(1);
      }
      if (result.notFound) {
        console.error(`Run "${runId}" not found in the queue.`);
        process.exit(1);
      }
      if (result.active) {
        console.error(`Run "${runId}" is active. Use \`kota workflow abort\` to cancel active runs.`);
        process.exit(1);
      }
      console.log(`Cancelled queued run ${runId}.`);
    });

  wfCmd
    .command("pause")
    .description("Pause dispatching new workflow runs (current run completes normally)")
    .action(async () => {
      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.pause();
        if (result) {
          if (result.already) {
            console.log("Dispatch is already paused.");
          } else {
            console.log("Dispatch paused. Run `kota workflow resume` to re-enable.");
          }
          return;
        }
      }
      // Daemon not reachable — fall back to signal file
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
    .action(async () => {
      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.resume();
        if (result) {
          if (result.already) {
            console.log("Dispatch is not paused.");
          } else {
            console.log("Dispatch resumed.");
          }
          return;
        }
      }
      // Daemon not reachable — fall back to signal file
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
    .action(async () => {
      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const result = await client.reload();
        if (result) {
          console.log(`Workflow definitions reloaded (${result.count} definition(s)).`);
          return;
        }
      }
      // Daemon not reachable — fall back to signal file
      const store = new WorkflowRunStore();
      const reloadPath = join(store.rootDir, RELOAD_SIGNAL_FILE);
      writeFileSync(reloadPath, "");
      console.log("Reload signal written. The daemon will reload definitions on its next cycle.");
    });

  wfCmd
    .command("disable <name>")
    .description("Disable a workflow at runtime (in-memory only; reset by reload)")
    .action(async (name: string) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("No running daemon found. Cannot disable a workflow without a daemon.");
        process.exit(1);
      }
      const result = await client.disableWorkflow(name);
      if (!result) {
        console.error("Failed to reach daemon.");
        process.exit(1);
      }
      if (result.notFound) {
        console.error(`Workflow "${name}" not found.`);
        process.exit(1);
      }
      console.log(`Workflow "${name}" disabled. Run \`kota workflow enable ${name}\` or \`kota workflow reload\` to re-enable.`);
    });

  wfCmd
    .command("enable <name>")
    .description("Enable a workflow at runtime (in-memory only; reset by reload)")
    .action(async (name: string) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("No running daemon found. Cannot enable a workflow without a daemon.");
        process.exit(1);
      }
      const result = await client.enableWorkflow(name);
      if (!result) {
        console.error("Failed to reach daemon.");
        process.exit(1);
      }
      if (result.notFound) {
        console.error(`Workflow "${name}" not found.`);
        process.exit(1);
      }
      console.log(`Workflow "${name}" enabled.`);
    });

  wfCmd
    .command("status")
    .description("Show active run, queue, and per-workflow last-run info")
    .action(async () => {
      const client = DaemonControlClient.fromStateDir();
      if (client) {
        const wf = await client.getWorkflowStatus();
        if (wf) {
          printWorkflowStatus({
            activeRuns: wf.activeRuns,
            pendingRuns: wf.pendingRuns,
            paused: wf.paused,
            pendingAbort: false,
            completedRuns: wf.completedRuns,
            totalCostUsd: wf.totalCostUsd,
            agentBackoff: wf.agentBackoff,
            definitionsLoadedAt: wf.definitionsLoadedAt,
            workflows: wf.workflows,
            dailySpend: undefined,
            dailyBudget: undefined,
            dispatchWindowBlocked: wf.dispatchWindowBlocked,
            dispatchWindowOpensAt: wf.dispatchWindowOpensAt,
          });
          return;
        }
      }
      // Daemon not reachable — read from persisted state files
      const store = new WorkflowRunStore();
      const state = store.readState();
      const config = loadConfig();
      const dispatchWindow = config.scheduler?.dispatchWindow;
      const windowBlocked = dispatchWindow ? !isWithinDispatchWindow(dispatchWindow) : false;
      const windowOpensAt = windowBlocked && dispatchWindow
        ? new Date(Date.now() + msUntilDispatchWindowOpens(dispatchWindow)).toISOString()
        : undefined;
      printWorkflowStatus({
        activeRuns: state.activeRuns ?? [],
        pendingRuns: state.pendingRuns,
        paused: existsSync(join(store.rootDir, PAUSE_SIGNAL_FILE)),
        pendingAbort: existsSync(join(store.rootDir, ABORT_SIGNAL_FILE)),
        completedRuns: state.completedRuns,
        totalCostUsd: state.totalCostUsd,
        agentBackoff: state.agentBackoff,
        definitionsLoadedAt: state.definitionsLoadedAt,
        workflows: state.workflows,
        dailySpend: store.getDailySpendUsd(),
        dailyBudget: config.dailyBudgetUsd,
        dispatchWindowBlocked: windowBlocked || undefined,
        dispatchWindowOpensAt: windowOpensAt,
      });
    });
}

type StatusOptions = {
  activeRuns: Array<{ runId: string; workflow: string; startedAt?: string }>;
  pendingRuns: Array<{ runId?: string; workflowName: string; trigger: { event: string }; notBeforeMs: number }>;
  paused: boolean;
  pendingAbort: boolean;
  completedRuns: number;
  totalCostUsd?: number;
  agentBackoff?: { kind: string; until: string; failureCount: number };
  definitionsLoadedAt?: string;
  workflows: Record<
    string,
    {
      lastRunId?: string;
      lastStartedAt?: string;
      lastCompletedAt?: string;
      lastStatus?: string;
      nextScheduledAt?: string;
    }
  >;
  dailySpend: number | undefined;
  dailyBudget: number | undefined;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
};

function printWorkflowStatus(opts: StatusOptions): void {
  if (opts.paused) {
    console.log("Dispatch: PAUSED (run `kota workflow resume` to re-enable)");
  } else if (opts.dispatchWindowBlocked) {
    const opensAt = opts.dispatchWindowOpensAt
      ? ` (opens ${formatWindowTime(opts.dispatchWindowOpensAt)})`
      : "";
    console.log(`Dispatch: blocked by window${opensAt}`);
  }

  if (opts.activeRuns.length === 0) {
    console.log("Active run: (none)");
  } else {
    for (const run of opts.activeRuns) {
      console.log(`Active run: ${run.runId}${opts.pendingAbort ? " (abort pending)" : ""}`);
      console.log(`Workflow:   ${run.workflow}`);
      if (run.startedAt) {
        const elapsed = Date.now() - new Date(run.startedAt).getTime();
        console.log(`Running for: ${formatDuration(elapsed)}`);
      }
    }
  }

  console.log();
  if (opts.pendingRuns.length === 0) {
    console.log("Queue: empty");
  } else {
    console.log(`Queue (${opts.pendingRuns.length}):`);
    for (const q of opts.pendingRuns) {
      const notBefore = q.notBeforeMs > Date.now()
        ? ` (not before ${new Date(q.notBeforeMs).toLocaleTimeString()})`
        : "";
      const idSuffix = q.runId ? `  [${q.runId}]` : "";
      console.log(`  • ${q.workflowName} — ${q.trigger.event}${notBefore}${idSuffix}`);
    }
  }

  const wfNames = Object.keys(opts.workflows);
  if (wfNames.length > 0) {
    console.log();
    console.log("Per-workflow last run:");
    const nameWidth = Math.max(...wfNames.map((n) => n.length), 10);
    const hasScheduled = wfNames.some((n) => opts.workflows[n].nextScheduledAt);
    const schedWidth = 22;
    const header = hasScheduled
      ? `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} ${"Next Run".padEnd(schedWidth)} Last Run ID`
      : `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} Last Run ID`;
    const sepLen = nameWidth + 12 + 22 + (hasScheduled ? schedWidth + 1 : 0) + 42 + 4;
    console.log(header);
    console.log(`  ${"-".repeat(sepLen)}`);
    for (const name of wfNames) {
      const wf = opts.workflows[name];
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

  console.log();
  console.log(`Total completed runs: ${opts.completedRuns}`);
  if (opts.totalCostUsd != null) {
    console.log(`Total cost:           $${opts.totalCostUsd.toFixed(4)}`);
  }
  if (opts.dailyBudget != null && opts.dailySpend != null) {
    const budgetStatus = opts.dailySpend >= opts.dailyBudget ? " ⚠ budget reached" : "";
    console.log(`Today's spend:        $${opts.dailySpend.toFixed(4)} / $${opts.dailyBudget.toFixed(4)}${budgetStatus}`);
  } else if (opts.dailySpend != null && opts.dailySpend > 0) {
    console.log(`Today's spend:        $${opts.dailySpend.toFixed(4)}`);
  }
  if (opts.agentBackoff) {
    console.log(
      `Agent backoff:        ${opts.agentBackoff.kind} until ${formatDate(opts.agentBackoff.until)} (attempt ${opts.agentBackoff.failureCount})`,
    );
  }
  if (opts.definitionsLoadedAt) {
    console.log(`Definitions loaded:   ${formatDate(opts.definitionsLoadedAt)}`);
  }
}

/** Format an ISO timestamp as a human-readable day+time string, e.g. "Mon 09:00". */
function formatWindowTime(iso: string): string {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}
