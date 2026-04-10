import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import type { WorkflowNotifyConfig } from "./types.js";

const MAX_ERROR_LENGTH = 300;

function readErrorFile(projectDir: string, runDir: string): string {
  try {
    return readFileSync(resolve(projectDir, runDir, "error.txt"), "utf-8").trim();
  } catch {
    return "";
  }
}

function buildAlertText(
  workflow: string,
  runId: string,
  status: "failed" | "interrupted",
  durationMs: number,
  errorSummary: string,
): string {
  const durationSec = (durationMs / 1000).toFixed(1);
  const lines = [
    `Workflow ${status}: *${workflow}*`,
    `Run: \`${runId}\``,
    `Duration: ${durationSec}s`,
  ];
  if (errorSummary) {
    const truncated =
      errorSummary.length > MAX_ERROR_LENGTH
        ? `${errorSummary.slice(0, MAX_ERROR_LENGTH - 3)}...`
        : errorSummary;
    lines.push(`Error: ${truncated}`);
  }
  return lines.join("\n");
}

export type FailureAlertOptions = {
  alertCooldownMs?: number;
  /** Returns the notify config for a workflow by name, if defined. */
  getWorkflowNotify?: (workflowName: string) => WorkflowNotifyConfig | undefined;
};

export function subscribeWorkflowFailureAlert(
  bus: EventBus,
  projectDir: string,
  _log?: (message: string) => void,
  opts?: FailureAlertOptions,
): () => void {
  const cooldownMs = opts?.alertCooldownMs ?? 0;
  const lastAlertAt = new Map<string, number>();

  return bus.on("workflow.completed", (payload) => {
    if (payload.status !== "failed" && payload.status !== "interrupted") return;

    const notify = opts?.getWorkflowNotify?.(payload.workflow);
    if (notify?.onFailure === false) return;

    if (cooldownMs > 0) {
      const last = lastAlertAt.get(payload.workflow);
      const now = Date.now();
      if (last !== undefined && now - last < cooldownMs) return;
      lastAlertAt.set(payload.workflow, now);
    }

    const errorSummary = readErrorFile(projectDir, payload.runDir);
    const text = buildAlertText(
      payload.workflow,
      payload.runId,
      payload.status,
      payload.durationMs,
      errorSummary,
    );

    bus.emit("workflow.failure.alert", {
      workflow: payload.workflow,
      runId: payload.runId,
      status: payload.status,
      durationMs: payload.durationMs,
      errorSummary,
      text,
    });
  });
}
