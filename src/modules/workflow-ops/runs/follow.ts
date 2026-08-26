import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { DaemonSseEvent, WorkflowLiveStatus } from "#core/daemon/daemon-control.js";
import {
  type DaemonTransport,
  getDaemonTransport,
} from "#core/server/daemon-transport.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { readWorkflowOperationalState } from "#core/workflow/run-operational-projection.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { type LineNode, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDuration, statusIcon } from "../utils.js";
import { buildRunLogs, followRunLogs, stepBanner } from "./workflow-logs.js";

function printRunSummary(metadata: WorkflowRunMetadata): void {
  const lines: LineNode[] = [
    line(plain("")),
    line(plain("─".repeat(64))),
    line(plain(`Run:      ${metadata.id}`)),
    line(plain(`Workflow: ${metadata.workflow}`)),
    line(plain(`Status:   ${statusIcon(metadata.status)} ${metadata.status}`)),
  ];
  if (metadata.durationMs != null) {
    lines.push(line(plain(`Duration: ${formatDuration(metadata.durationMs)}`)));
  }
  if (metadata.usage !== undefined) {
    const cost = metadata.usage.cost.state === "complete"
      ? `$${metadata.usage.cost.usd.toFixed(4)}`
      : metadata.usage.cost.state;
    lines.push(line(plain(`Cost:     ${cost}`)));
  }
  print(stack(...lines));
}

function emitPendingStepOutput(
  store: WorkflowRunStore,
  runId: string,
  metadata: WorkflowRunMetadata,
  emittedSteps: Set<string>,
  stepOutputOffset: Map<string, number>,
): void {
  const agentSteps = metadata.steps.filter((s) => s.type === "agent");
  for (const step of agentSteps) {
    const offset = stepOutputOffset.get(step.id) ?? 0;
    const stepLogs = buildRunLogs(store.runsDir, runId, metadata, step.id);
    if (stepLogs.length === 0) continue;
    const lines = stepLogs[0].lines.slice(offset);
    if (lines.length > 0) {
      if (!emittedSteps.has(step.id)) {
        print(line(plain("")));
        print(line(plain(stepBanner(step.id))));
        emittedSteps.add(step.id);
      }
      for (const l of lines) print(line(plain(l)));
      stepOutputOffset.set(step.id, offset + lines.length);
    }
  }
}

async function followWithSse(
  link: DaemonTransport,
  store: WorkflowRunStore,
  targetRunId: string | undefined,
): Promise<void> {
  let activeRunId = targetRunId;

  if (!activeRunId) {
    const wfStatus = await link.request<WorkflowLiveStatus>("GET", "/workflow/status");
    if (wfStatus && wfStatus.activeRuns.length > 0) {
      activeRunId = wfStatus.activeRuns[0].runId;
      print(line(plain(`Following run: ${activeRunId}`)));
    }
  }

  const emittedSteps = new Set<string>();
  const stepOutputOffset = new Map<string, number>();

  return new Promise<void>((resolve, reject) => {
    let done = false;
    const streamAbort = new AbortController();

    const settle = (error?: Error) => {
      if (done) return;
      done = true;
      streamAbort.abort();
      process.removeListener("SIGINT", onSigint);
      if (error !== undefined) reject(error);
      else resolve();
    };

    const onSigint = () => {
      print(line(plain("")));
      print(line(plain("Detached. Run continues in background.")));
      settle();
    };
    process.once("SIGINT", onSigint);

    async function handleEvent(event: DaemonSseEvent): Promise<void> {
      if (done) return;

      if (event.type === "workflow.started") {
        if (!activeRunId) {
          activeRunId = event.payload.runId;
          print(line(plain(`Following run: ${activeRunId}`)));
        }
        return;
      }

      if (event.type === "workflow.step.completed") {
        if (!activeRunId || event.payload.runId !== activeRunId) return;
        const metadata = readWorkflowRunMetadataFile(
          join(store.runsDir, activeRunId, "metadata.json"),
        );
        if (metadata) emitPendingStepOutput(store, activeRunId, metadata, emittedSteps, stepOutputOffset);
        const { stepId, status, durationMs } = event.payload;
        const dur = formatDuration(durationMs);
        print(line(plain("")));
        print(line(plain(`${statusIcon(status)} Step completed: ${stepId} [${status}] ${dur}`)));
        return;
      }

      if (event.type === "workflow.completed") {
        if (!activeRunId || event.payload.runId !== activeRunId) return;
        const metadata = readWorkflowRunMetadataFile(
          join(store.runsDir, activeRunId, "metadata.json"),
        );
        if (metadata) {
          emitPendingStepOutput(store, activeRunId, metadata, emittedSteps, stepOutputOffset);
          printRunSummary(metadata);
        } else {
          const { status, durationMs } = event.payload;
          const dur = formatDuration(durationMs);
          print(line(plain("")));
          print(line(plain(`Run ${activeRunId}: ${statusIcon(status)} ${status} ${dur}`)));
        }
        settle();
      }
    }

    async function streamEvents(): Promise<void> {
      for await (const event of link.events({ signal: streamAbort.signal })) {
        if (done) break;
        await handleEvent(event);
      }
      settle();
    }

    void streamEvents().catch((error) => {
      if (!done) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

export function registerFollowCommand(wfCmd: Command): void {
  wfCmd
    .command("follow [run-id]")
    .description(
      "Stream live output from an active workflow run.\n" +
      "  With no run ID, attaches to the current active run.\n" +
      "  Ctrl-C detaches without aborting the run.",
    )
    .action(async (runId: string | undefined) => {
      const store = new WorkflowRunStore();
      const link = getDaemonTransport();

      let resolvedId = runId;
      if (runId && !runId.includes("Z-")) {
        const dirs = readdirSync(store.runsDir).sort().reverse();
        const match = dirs.find((d) => d.startsWith(runId));
        if (!match) {
          print(line(span(`Run "${runId}" not found.`, "error")));
          process.exit(1);
        }
        resolvedId = match;
      }

      if (resolvedId) {
        const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
        const metadata = readWorkflowRunMetadataFile(metadataPath);
        if (metadata && metadata.status !== "running") {
          const stepLogs = buildRunLogs(store.runsDir, resolvedId, metadata);
          for (const { stepId, lines } of stepLogs) {
            print(line(plain("")));
            print(line(plain(stepBanner(stepId))));
            for (const l of lines) print(line(plain(l)));
          }
          printRunSummary(metadata);
          return;
        }
      }

      if (link) {
        await followWithSse(link, store, resolvedId);
      } else {
        if (!resolvedId) {
          const firstActiveRunId = readWorkflowOperationalState({
            stateDir: store.rootDir,
            projectDir: process.cwd(),
          }).activeRuns[0]?.runId;
          if (!firstActiveRunId) {
            print(line(plain("No active run found and daemon is not running.")));
            return;
          }
          resolvedId = firstActiveRunId;
          print(line(plain(`Following run: ${resolvedId}`)));
        }
        await followRunLogs(
          store.runsDir,
          { stateDir: store.rootDir, projectDir: process.cwd() },
          resolvedId,
          undefined,
        );
      }
    });
}
