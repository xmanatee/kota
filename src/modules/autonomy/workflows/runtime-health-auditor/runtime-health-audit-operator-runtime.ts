import { basename, join } from "node:path";
import { readStoredWorkflowRuntimeState } from "#core/workflow/stored-runtime-state.js";
import type {
  AutonomyHealthEvidenceRef,
  AutonomyHealthSeverity,
} from "#modules/autonomy/health-signal.js";
import {
  buildOperatorRuntimeInboxItems,
  type OperatorInboxItem,
} from "#modules/daemon-ops/operator-inbox.js";
import type { StatusSnapshot } from "#modules/daemon-ops/status-cli.js";
import { readStatusRunProjection } from "#modules/daemon-ops/status-cli-gather.js";
import { classifyDaemonControlFileForAudit } from "./daemon-control-health.js";
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

function readDurableWorkflowSnapshot(
  stateDir: string,
  scopeRoot: string,
): DurableWorkflowSnapshot {
  const projection = readStatusRunProjection(stateDir, scopeRoot);
  return {
    activeRuns: projection.runs.filter(
      (run) => run.state === "running" || run.state === "integrating",
    ).length,
    queuedRuns: projection.runs.filter((run) => run.state === "queued").length,
    workflowPaused: readStoredWorkflowRuntimeState(scopeRoot, stateDir).operatorPaused,
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
  scopeRoot: string,
): StatusSnapshot {
  const controlFile = classifyDaemonControlFileForAudit(stateDir);
  const durableWorkflow = readDurableWorkflowSnapshot(stateDir, scopeRoot);
  const runProjection = readStatusRunProjection(stateDir, scopeRoot);
  const daemonRunning = controlFile.kind === "fresh";
  return {
    daemonRunning,
    ...(daemonRunning ? { daemonPid: controlFile.pid } : {}),
    activeRuns: durableWorkflow.activeRuns,
    queuedRuns: durableWorkflow.queuedRuns,
    workflowPaused: durableWorkflow.workflowPaused,
    sessions: 0,
    pendingApprovals: 0,
    scopeRoot: scopeRoot,
    scopeName: basename(scopeRoot) || scopeRoot,
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
  const status = buildOperatorRuntimeStatusForAudit(ctx.stateDir, ctx.scopeRoot);
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
