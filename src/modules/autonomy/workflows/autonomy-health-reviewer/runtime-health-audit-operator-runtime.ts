import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isProcessAlive } from "#core/util/process-alive.js";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime-signals.js";
import type {
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
} from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "#modules/autonomy/health-signal.js";
import {
  buildOperatorRuntimeInboxItems,
  type OperatorInboxItem,
} from "#modules/daemon-ops/operator-inbox.js";
import type { StatusSnapshot } from "#modules/daemon-ops/status-cli.js";
import { readStatusRunProjection } from "#modules/daemon-ops/status-cli-gather.js";
import {
  addPattern,
  type RuntimeHealthAuditContext,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type DurableWorkflowSnapshot = {
  activeRuns: number;
  queuedRuns: number;
  workflowPaused: boolean;
};

function classifyDaemonControlFileForAudit(
  stateDir: string,
): StatusSnapshot["controlFile"] {
  const controlPath = join(stateDir, "daemon-control.json");
  if (!existsSync(controlPath)) return { kind: "missing" };
  let parsed: AutonomyHealthJsonValue;
  try {
    parsed = JSON.parse(readFileSync(controlPath, "utf-8")) as AutonomyHealthJsonValue;
  } catch {
    return { kind: "unreadable" };
  }
  if (
    !isAutonomyHealthJsonObject(parsed) ||
    typeof parsed.port !== "number" ||
    typeof parsed.pid !== "number"
  ) {
    return { kind: "unreadable" };
  }
  const baseURL = `http://127.0.0.1:${parsed.port}`;
  if (isProcessAlive(parsed.pid)) {
    return { kind: "fresh", pid: parsed.pid, baseURL };
  }
  return { kind: "stale", pid: parsed.pid, baseURL };
}

function readDurableWorkflowSnapshot(
  stateDir: string,
  scopeDir: string,
): DurableWorkflowSnapshot {
  const projection = readStatusRunProjection(stateDir, scopeDir);
  return {
    activeRuns: projection.runs.filter(
      (run) => run.state === "running" || run.state === "integrating",
    ).length,
    queuedRuns: projection.runs.filter((run) => run.state === "queued").length,
    workflowPaused: existsSync(join(stateDir, PAUSE_SIGNAL_FILE)),
  };
}

function hasDurableWorkflowWarning(
  snapshot: DurableWorkflowSnapshot,
): boolean {
  return (
    snapshot.activeRuns > 0 ||
    snapshot.queuedRuns > 0 ||
    snapshot.workflowPaused
  );
}

function buildOperatorRuntimeStatusForAudit(
  stateDir: string,
  scopeDir: string,
): StatusSnapshot {
  const controlFile = classifyDaemonControlFileForAudit(stateDir);
  const durableWorkflow = readDurableWorkflowSnapshot(stateDir, scopeDir);
  const runProjection = readStatusRunProjection(stateDir, scopeDir);
  const daemonRunning = controlFile.kind === "fresh";
  return {
    daemonRunning,
    ...(daemonRunning ? { daemonPid: controlFile.pid } : {}),
    activeRuns: durableWorkflow.activeRuns,
    queuedRuns: durableWorkflow.queuedRuns,
    workflowPaused: durableWorkflow.workflowPaused,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: scopeDir,
    projectName: basename(scopeDir) || scopeDir,
    controlFile,
    runProjection,
  };
}

function runtimeInboxEvidenceRef(item: OperatorInboxItem): AutonomyHealthEvidenceRef {
  const ref =
    item.id === "offline-workflow-store"
      ? join(".kota", "kota.sqlite")
      : join(".kota", "daemon-control.json");
  return {
    kind: "artifact",
    ref,
    summary: truncateSingleLine(`${item.title}: ${item.detail} Action: ${item.action}`),
  };
}

function runtimeInboxLabels(item: OperatorInboxItem): string[] {
  const labels = ["operator-action", "runtime", "operator-inbox", item.id];
  if (item.id.startsWith("daemon-control")) labels.push("daemon-control");
  if (item.id.startsWith("daemon-")) labels.push("daemon");
  if (item.id === "offline-workflow-store") labels.push("workflow-store");
  return labels;
}

function runtimeInboxSeverity(item: OperatorInboxItem): AutonomyHealthSeverity {
  return item.role === "error" ? "error" : "warning";
}

export function scanOperatorRuntimeWarnings(
  ctx: RuntimeHealthAuditContext,
): void {
  const status = buildOperatorRuntimeStatusForAudit(ctx.stateDir, ctx.scopeDir);
  const hasControlFileEvidence = status.controlFile.kind !== "missing";
  const hasWorkflowEvidence = hasDurableWorkflowWarning(status);
  const items = buildOperatorRuntimeInboxItems(status).filter(
    (item) =>
      item.id !== "daemon-offline" || hasControlFileEvidence || hasWorkflowEvidence,
  );
  ctx.inspected.operatorRuntimeWarnings += items.length;

  for (const item of items) {
    addPattern(ctx, {
      dedupeKey: `operator-inbox:runtime:${item.id}`,
      category: "operator-action",
      severity: runtimeInboxSeverity(item),
      actionability: "owner-action",
      labels: runtimeInboxLabels(item),
      summary: `Operator runtime inbox warning: ${item.title}. ${item.detail}`,
      source: { kind: "inbox", id: `runtime:${item.id}` },
      evidenceRefs: [runtimeInboxEvidenceRef(item)],
    });
  }
}
