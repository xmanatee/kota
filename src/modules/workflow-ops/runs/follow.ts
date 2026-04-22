import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { DaemonSseEvent } from "#core/daemon/daemon-control.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata, WorkflowRuntimeState } from "#core/workflow/run-types.js";
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
  if (metadata.totalCostUsd != null) {
    lines.push(line(plain(`Cost:     $${metadata.totalCostUsd.toFixed(4)}`)));
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
  client: DaemonControlClient,
  store: WorkflowRunStore,
  targetRunId: string | undefined,
): Promise<void> {
  let activeRunId = targetRunId;

  if (!activeRunId) {
    const wfStatus = await client.getWorkflowStatus();
    if (wfStatus && wfStatus.activeRuns.length > 0) {
      activeRunId = wfStatus.activeRuns[0].runId;
      print(line(plain(`Following run: ${activeRunId}`)));
    }
  }

  const emittedSteps = new Set<string>();
  const stepOutputOffset = new Map<string, number>();

  return new Promise<void>((resolve) => {
    let done = false;

    const cleanup = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };

    process.once("SIGINT", () => {
      print(line(plain("")));
      print(line(plain("Detached. Run continues in background.")));
      cleanup();
    });

    async function handleEvent(event: DaemonSseEvent): Promise<void> {
      if (done) return;
      const p = event.payload as Record<string, unknown>;
      const eventRunId = p.runId as string | undefined;

      if (event.type === "workflow.started" && !activeRunId) {
        activeRunId = eventRunId;
        print(line(plain(`Following run: ${activeRunId}`)));
        return;
      }

      if (activeRunId && eventRunId && eventRunId !== activeRunId) return;
      if (!activeRunId) return;

      if (event.type === "workflow.step.completed") {
        const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
          join(store.runsDir, activeRunId, "metadata.json"),
        );
        if (metadata) emitPendingStepOutput(store, activeRunId, metadata, emittedSteps, stepOutputOffset);
        const stepId = p.stepId as string;
        const status = p.status as string;
        const dur = typeof p.durationMs === "number" ? formatDuration(p.durationMs) : "";
        print(line(plain("")));
        print(line(plain(`${statusIcon(status)} Step completed: ${stepId} [${status}] ${dur}`)));
      }

      if (event.type === "workflow.completed") {
        const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
          join(store.runsDir, activeRunId, "metadata.json"),
        );
        if (metadata) {
          emitPendingStepOutput(store, activeRunId, metadata, emittedSteps, stepOutputOffset);
          printRunSummary(metadata);
        } else {
          const status = p.status as string;
          const dur = typeof p.durationMs === "number" ? formatDuration(p.durationMs) : "";
          print(line(plain("")));
          print(line(plain(`Run ${activeRunId}: ${statusIcon(status)} ${status} ${dur}`)));
        }
        cleanup();
      }
    }

    async function waitForRunThenStream(): Promise<void> {
      if (!activeRunId) {
        const pollTimer = setInterval(async () => {
          if (done) {
            clearInterval(pollTimer);
            return;
          }
          const wfStatus = await client.getWorkflowStatus();
          if (wfStatus && wfStatus.activeRuns.length > 0) {
            activeRunId = wfStatus.activeRuns[0].runId;
            print(line(plain(`Following run: ${activeRunId}`)));
            clearInterval(pollTimer);
            void streamEvents();
          }
        }, 1_000);
        return;
      }
      void streamEvents();
    }

    async function streamEvents(): Promise<void> {
      for await (const event of client.events()) {
        if (done) break;
        await handleEvent(event);
      }
      if (!done) cleanup();
    }

    void waitForRunThenStream();
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
      const client = DaemonControlClient.fromStateDir();

      let resolvedId = runId;
      if (runId && !runId.includes("Z-")) {
        try {
          const dirs = readdirSync(store.runsDir).sort().reverse();
          const match = dirs.find((d) => d.startsWith(runId));
          if (!match) {
            print(line(span(`Run "${runId}" not found.`, "error")));
            process.exit(1);
          }
          resolvedId = match;
        } catch {
          print(line(span(`Run "${runId}" not found.`, "error")));
          process.exit(1);
        }
      }

      if (resolvedId) {
        const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
        const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
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

      if (client) {
        await followWithSse(client, store, resolvedId);
      } else {
        if (!resolvedId) {
          const wfState = readOptionalJsonFile<WorkflowRuntimeState>(store.statePath);
          const firstActiveRunId = wfState?.activeRuns?.[0]?.runId;
          if (!firstActiveRunId) {
            print(line(plain("No active run found and daemon is not running.")));
            return;
          }
          resolvedId = firstActiveRunId;
          print(line(plain(`Following run: ${resolvedId}`)));
        }
        await followRunLogs(store.runsDir, store.statePath, resolvedId, undefined);
      }
    });
}
