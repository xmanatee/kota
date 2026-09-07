import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { BusEvents } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import type { StoredRun } from "#core/workflow/run-state-database.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import {
  type AutonomyIssueRuntimeScope,
  resolveAutonomyIssueRuntimeScope,
} from "./autonomy-issue-runtime-scope.js";
import {
  emitHealth,
  stableIssueHash,
  stableToken,
  workflowFailureHealthShape,
  workflowFailureHealthSource,
  workflowFailureIssueKey,
} from "./autonomy-issue-source-shared.js";

type WorkflowSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

function containedPath(scopeRoot: string, candidate: string): string | null {
  const absolute = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(scopeRoot, candidate);
  const rel = relative(resolve(scopeRoot), absolute);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? null
    : absolute;
}

function runErrorSummary(
  runtime: AutonomyIssueRuntimeScope,
  payload: BusEvents["workflow.completed"],
): string {
  const runDir = containedPath(runtime.workspaceRoot, payload.runDir);
  if (runDir === null) return "";
  const errorPath = resolve(runDir, "error.txt");
  if (!existsSync(errorPath)) return "";
  try {
    return readFileSync(errorPath, "utf-8").trim();
  } catch {
    return "";
  }
}

function runEvidenceRef(
  runtime: AutonomyIssueRuntimeScope,
  payload: BusEvents["workflow.completed"],
): string {
  const runDir = containedPath(runtime.workspaceRoot, payload.runDir);
  return runDir === null
    ? `.kota/runs/${stableToken(payload.runId)}/metadata.json`
    : `${relative(runtime.workspaceRoot, runDir)}/metadata.json`;
}

function isVolatileTriggerField(key: string): boolean {
  return key === "_runId" ||
    key === "eventId" ||
    key === "idempotencyKey" ||
    key === "timestamp" ||
    key.endsWith("At");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => !isVolatileTriggerField(key))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function workflowHealthContractLabel(run: StoredRun): string {
  return `contract/${stableIssueHash(stableJson({
    event: run.trigger.event,
    payload: run.trigger.payload,
  }))}`;
}

function currentProjection(
  runtime: AutonomyIssueRuntimeScope,
): AutonomyIssueProjection {
  return decodeAutonomyIssueProjection(
    runtime.runState.readScopeStateValue<AutonomyIssueProjection>(
      runtime.scopeId,
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    ).value,
  );
}

function emitFailure(
  ctx: WorkflowSourceContext,
  runtime: AutonomyIssueRuntimeScope,
  payload: BusEvents["workflow.completed"],
): void {
  const errorSummary = runErrorSummary(runtime, payload);
  const run = runtime.runState.getRun(payload.runId);
  const contractLabel = run === null
    ? "contract/unattributed"
    : workflowHealthContractLabel(run);
  const shape = workflowFailureHealthShape({
    failureKind: payload.failureKind ?? payload.status,
    triggerEvent: payload.triggerEvent,
    contractLabels: [contractLabel],
  });
  emitHealth(ctx, runtime.scopeId, {
    observation: "present",
    source: workflowFailureHealthSource(payload.workflow),
    ...shape,
    summary:
      `Workflow ${payload.workflow} reached ${payload.status}; ` +
      "the retained run owns diagnostic detail.",
    evidenceRefs: [{
      kind: "run",
      ref: runEvidenceRef(runtime, payload),
    }],
    dedupeKey: workflowFailureIssueKey({
      workflowName: payload.workflow,
      errorSummary,
      fallback: payload.failureKind ?? payload.status,
    }),
    observationCount: 1,
    createdAt:
      runtime.runStore.getRun(payload.runId)?.completedAt ??
      new Date().toISOString(),
  });
}

function emitSuccessfulProbes(
  ctx: WorkflowSourceContext,
  runtime: AutonomyIssueRuntimeScope,
  payload: BusEvents["workflow.completed"],
): void {
  const successfulRun = runtime.runState.getRun(payload.runId);
  if (successfulRun === null) return;
  const contractLabel = workflowHealthContractLabel(successfulRun);
  const sourcePrefix = `workflow:${stableToken(payload.workflow)}:failure:`;
  for (const issue of currentProjection(runtime).issues) {
    if (
      issue.status === "resolved" ||
      issue.source.workflow !== payload.workflow ||
      !issue.labels.includes(contractLabel) ||
      !issue.rootCauseKey.startsWith(sourcePrefix)
    ) {
      continue;
    }
    emitHealth(ctx, runtime.scopeId, {
      observation: "cleared",
      source: issue.source,
      severity: issue.severity,
      labels: issue.labels,
      summary:
        `Workflow ${payload.workflow} completed successfully at the same runtime boundary.`,
      evidenceRefs: [{
        kind: "run",
        ref: runEvidenceRef(runtime, payload),
      }],
      actionability: issue.actionability,
      dedupeKey: issue.rootCauseKey,
      observationCount: 1,
      createdAt:
        runtime.runStore.getRun(payload.runId)?.completedAt ??
        new Date().toISOString(),
    });
  }
}

export function subscribeWorkflowHealth(
  ctx: WorkflowSourceContext,
): void {
  ctx.events.subscribe("workflow.completed", (payload) => {
    // These workflows consume and materialize this source. Re-emitting their
    // own failures would create a typed event feedback loop; their durable
    // dead letters and the scheduled auditor remain the reconciliation path.
    if (
      payload.workflow === "autonomy-health-reviewer" ||
      payload.workflow === "autonomy-issue-projection-materialization"
    ) {
      return;
    }
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    if (payload.status === "failed" || payload.status === "interrupted") {
      emitFailure(ctx, runtime, payload);
      return;
    }
    emitSuccessfulProbes(ctx, runtime, payload);
  });
}
