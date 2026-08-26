import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import type { WorkflowStatusSnapshot } from "../client.js";
import { formatDate, formatDuration, statusIcon } from "../utils.js";

export function registerControlCommands(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("abort")
    .description("Abort the currently active workflow run(s)")
    .action(async () => {
      const result = await ctx.client.workflow.abort();
      if (result.status === "applied") {
        if (result.count === 0) {
          printWorkflowText("No active run to abort.");
        } else {
          printWorkflowText(`Aborted ${result.count} active run(s).`);
        }
        return;
      }
      if (result.runs.length === 0) {
        printWorkflowText("No active run to abort.");
        return;
      }
      if (result.runs.length === 1) {
        printWorkflowText(`Abort signal written for run ${result.runs[0].runId}`);
      } else {
        printWorkflowText(`Abort signal written for ${result.runs.length} active runs:`);
        for (const r of result.runs) printWorkflowText(`  ${r.runId} (${r.workflow})`);
      }
      printWorkflowText("The daemon will abort the active run(s) on its next cycle.");
    });

  wfCmd
    .command("cancel <run-id>")
    .description("Cancel a queued (pending) workflow run before it starts")
    .action(async (runId: string) => {
      const result = await ctx.client.workflow.cancelRun(runId);
      if (result.ok) {
        printWorkflowText(`Cancelled queued run ${runId}.`);
        return;
      }
      if (result.reason === "daemon_required") {
        printWorkflowError("No running daemon found. Cannot cancel a queued run without a daemon.");
        process.exit(1);
      }
      if (result.reason === "not_found") {
        printWorkflowError(`Run "${runId}" not found in the queue.`);
        process.exit(1);
      }
      if (result.reason === "active") {
        printWorkflowError(`Run "${runId}" is active. Use \`kota workflow abort\` to cancel active runs.`);
        process.exit(1);
      }
    });

  wfCmd
    .command("pause")
    .description("Pause dispatching new workflow runs (current run completes normally)")
    .action(async () => {
      const result = await ctx.client.workflow.pause();
      if (result.already) {
        printWorkflowText("Dispatch is already paused.");
        return;
      }
      printWorkflowText("Dispatch paused. Run `kota workflow resume` to re-enable.");
    });

  wfCmd
    .command("resume")
    .description("Resume dispatching new workflow runs")
    .option(
      "--retry-agent",
      "Clear agent backoff after fixing provider or authentication setup",
    )
    .action(async (options: { retryAgent?: boolean }) => {
      const result = await ctx.client.workflow.resume(
        options.retryAgent ? { retryAgent: true } : undefined,
      );
      if (result.already) {
        printWorkflowText(
          result.agentBackoffCleared
            ? "Agent backoff cleared; dispatch is running."
            : "Dispatch is not paused.",
        );
        return;
      }
      printWorkflowText(
        result.agentBackoffCleared
          ? "Dispatch resumed; agent backoff cleared."
          : "Dispatch resumed.",
      );
    });

  wfCmd
    .command("reload")
    .description("Signal the daemon to reload workflow definitions without restarting")
    .action(async () => {
      const result = await ctx.client.workflow.reload();
      if (result.status === "applied") {
        printWorkflowText(`Workflow definitions reloaded (${result.count} definition(s)).`);
        return;
      }
      printWorkflowText("Reload signal written. The daemon will reload definitions on its next cycle.");
    });

  wfCmd
    .command("disable <name>")
    .description("Disable a workflow at runtime (in-memory only; reset by reload)")
    .action(async (name: string) => {
      const result = await ctx.client.workflow.disable(name);
      if (result.ok) {
        printWorkflowText(`Workflow "${name}" disabled. Run \`kota workflow enable ${name}\` or \`kota workflow reload\` to re-enable.`);
        return;
      }
      if (result.reason === "daemon_required") {
        printWorkflowError("No running daemon found. Cannot disable a workflow without a daemon.");
      } else {
        printWorkflowError(`Workflow "${name}" not found.`);
      }
      process.exit(1);
    });

  wfCmd
    .command("enable <name>")
    .description("Enable a workflow at runtime (in-memory only; reset by reload)")
    .action(async (name: string) => {
      const result = await ctx.client.workflow.enable(name);
      if (result.ok) {
        printWorkflowText(`Workflow "${name}" enabled.`);
        return;
      }
      if (result.reason === "daemon_required") {
        printWorkflowError("No running daemon found. Cannot enable a workflow without a daemon.");
      } else {
        printWorkflowError(`Workflow "${name}" not found.`);
      }
      process.exit(1);
    });

  wfCmd
    .command("status")
    .description("Show active run, queue, and per-workflow last-run info")
    .action(async () => {
      const status = await ctx.client.workflow.status();
      printWorkflowStatus(status);
    });
}

function printWorkflowStatus(status: WorkflowStatusSnapshot): void {
  if (status.pause?.kind === "operator") {
    printWorkflowText("Dispatch: PAUSED by operator (run `kota workflow resume` to re-enable)");
  } else if (status.paused) {
    printWorkflowText("Dispatch: PAUSED at runtime (inspect daemon before resuming)");
  } else if (status.dispatchWindowBlocked) {
    const opensAt = status.dispatchWindowOpensAt
      ? ` (opens ${formatWindowTime(status.dispatchWindowOpensAt)})`
      : "";
    printWorkflowText(`Dispatch: blocked by window${opensAt}`);
  }

  if (status.activeRuns.length === 0) {
    printWorkflowText("Active run: (none)");
  } else {
    for (const run of status.activeRuns) {
      printWorkflowText(`Active run: ${run.runId}${status.pendingAbort ? " (abort pending)" : ""}`);
      printWorkflowText(`Workflow:   ${run.workflow}`);
      if (run.startedAt) {
        const elapsed = Date.now() - new Date(run.startedAt).getTime();
        printWorkflowText(`Running for: ${formatDuration(elapsed)}`);
      }
    }
  }

  printWorkflowText();
  if (status.pendingRuns.length === 0) {
    printWorkflowText("Queue: empty");
  } else {
    printWorkflowText(`Queue (${status.pendingRuns.length}):`);
    for (const q of status.pendingRuns) {
      const notBefore = q.notBeforeMs > Date.now()
        ? ` (not before ${new Date(q.notBeforeMs).toLocaleTimeString()})`
        : "";
      const idSuffix = q.runId ? `  [${q.runId}]` : "";
      printWorkflowText(`  • ${q.workflowName} — ${q.trigger.event}${notBefore}${idSuffix}`);
    }
  }

  const wfNames = Object.keys(status.workflows);
  if (wfNames.length > 0) {
    printWorkflowText();
    printWorkflowText("Per-workflow last run:");
    const nameWidth = Math.max(...wfNames.map((n) => n.length), 10);
    const hasScheduled = wfNames.some((n) => status.workflows[n].nextScheduledAt);
    const schedWidth = 22;
    const header = hasScheduled
      ? `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} ${"Next Run".padEnd(schedWidth)} Last Run ID`
      : `  ${"Workflow".padEnd(nameWidth)} ${"Status".padEnd(12)} ${"Completed".padEnd(22)} Last Run ID`;
    const sepLen = nameWidth + 12 + 22 + (hasScheduled ? schedWidth + 1 : 0) + 42 + 4;
    printWorkflowText(header);
    printWorkflowText(`  ${"-".repeat(sepLen)}`);
    for (const name of wfNames) {
      const wf = status.workflows[name];
      const completion = wf.lastCompletion;
      const st = completion ? `${statusIcon(completion.status)} ${completion.status}` : "(none)";
      const completed = completion ? formatDate(completion.completedAt) : "(none)";
      const runId = completion?.runId ?? wf.lastStarted?.runId ?? "(none)";
      if (hasScheduled) {
        const nextRun = wf.nextScheduledAt ? formatDate(wf.nextScheduledAt) : "(none)";
        printWorkflowText(
          `  ${name.padEnd(nameWidth)} ${st.padEnd(12)} ${completed.padEnd(22)} ${nextRun.padEnd(schedWidth)} ${runId}`,
        );
      } else {
        printWorkflowText(
          `  ${name.padEnd(nameWidth)} ${st.padEnd(12)} ${completed.padEnd(22)} ${runId}`,
        );
      }
    }
  }

  printWorkflowText();
  printWorkflowText(`Total completed runs: ${status.completedRuns}`);
  if (status.agentBackoff) {
    printWorkflowText(
      `Agent backoff:        ${status.agentBackoff.kind} until ${formatDate(status.agentBackoff.until)} (attempt ${status.agentBackoff.failureCount})`,
    );
  }
  printWorkflowText(`Concurrency:          ${status.concurrency}`);
  if (status.definitionsLoadedAt) {
    printWorkflowText(`Definitions loaded:   ${formatDate(status.definitionsLoadedAt)}`);
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
