import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { STATE_FILE } from "#core/workflow/run-store-snapshot.js";
import { PAUSE_SIGNAL_FILE } from "#core/workflow/runtime-signals.js";
import type {
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
} from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "#modules/autonomy/health-signal.js";
import {
  buildOperatorRuntimeInboxItems,
  type OperatorInboxItem,
} from "#modules/daemon-ops/operator-inbox.js";
import type { StatusSnapshot } from "#modules/daemon-ops/status-cli.js";
import {
  addPattern,
  type RuntimeHealthAuditContext,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type HistoricalWorkflowSnapshot = {
  activeRuns: number;
  queuedRuns: number;
  workflowPaused: boolean;
};

function classifyDaemonControlFileForAudit(
  projectDir: string,
): StatusSnapshot["controlFile"] {
  const controlPath = join(projectDir, ".kota", "daemon-control.json");
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

function readHistoricalWorkflowSnapshot(
  projectDir: string,
): HistoricalWorkflowSnapshot {
  const state = readOptionalJsonFile<AutonomyHealthJsonObject>(
    join(projectDir, ".kota", STATE_FILE),
  );
  return {
    activeRuns: Array.isArray(state?.activeRuns) ? state.activeRuns.length : 0,
    queuedRuns: Array.isArray(state?.pendingRuns) ? state.pendingRuns.length : 0,
    workflowPaused: existsSync(join(projectDir, ".kota", PAUSE_SIGNAL_FILE)),
  };
}

function hasHistoricalWorkflowWarning(
  snapshot: HistoricalWorkflowSnapshot,
): boolean {
  return (
    snapshot.activeRuns > 0 ||
    snapshot.queuedRuns > 0 ||
    snapshot.workflowPaused
  );
}

function buildOperatorRuntimeStatusForAudit(
  projectDir: string,
): StatusSnapshot {
  const controlFile = classifyDaemonControlFileForAudit(projectDir);
  const historicalWorkflow = readHistoricalWorkflowSnapshot(projectDir);
  const daemonRunning = controlFile.kind === "fresh";
  return {
    daemonRunning,
    ...(daemonRunning ? { daemonPid: controlFile.pid } : {}),
    activeRuns: daemonRunning ? historicalWorkflow.activeRuns : 0,
    queuedRuns: daemonRunning ? historicalWorkflow.queuedRuns : 0,
    workflowPaused: daemonRunning ? historicalWorkflow.workflowPaused : false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir,
    projectName: basename(projectDir) || projectDir,
    controlFile,
    ...(!daemonRunning ? { historicalWorkflow } : {}),
  };
}

function runtimeInboxEvidenceRef(item: OperatorInboxItem): AutonomyHealthEvidenceRef {
  const ref =
    item.id === "offline-workflow-store"
      ? join(".kota", STATE_FILE)
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
  const status = buildOperatorRuntimeStatusForAudit(ctx.projectDir);
  const hasControlFileEvidence = status.controlFile.kind !== "missing";
  const hasWorkflowEvidence =
    status.historicalWorkflow !== undefined &&
    hasHistoricalWorkflowWarning(status.historicalWorkflow);
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
