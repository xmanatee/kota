import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  buildAutonomyHealthReviewFromSignals,
  finalizeAutonomyHealthReviewActions,
  stageAutonomyHealthReviewActions,
} from "./health-review.js";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

export const RUNTIME_HEALTH_AUDIT_NOW = "2026-06-19T12:00:00.000Z";

export function makeRuntimeHealthAuditScopeRoot(): string {
  const workspaceRoot = join(
    tmpdir(),
    `kota-runtime-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
  return workspaceRoot;
}

export function collectRuntimeHealthAuditForScope(args: {
  workspaceRoot: string;
  options?: Parameters<typeof collectRuntimeHealthAudit>[0]["options"];
}) {
  return collectRuntimeHealthAudit({
    workspaceRoot: args.workspaceRoot,
    scopeRoot: args.workspaceRoot,
    stateDir: join(args.workspaceRoot, ".kota"),
    ...(args.options !== undefined ? { options: args.options } : {}),
  });
}

export function reviewAndApplyRuntimeHealthAudit(
  workspaceRoot: string,
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
) {
  const review = buildAutonomyHealthReviewFromSignals({
    signals: audit.signals,
    generatedAt: RUNTIME_HEALTH_AUDIT_NOW,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
  const currentProjection = readAutonomyIssueProjection(workspaceRoot);
  const repositoryActions = stageAutonomyHealthReviewActions({
    workspaceRoot,
    currentProjection,
    scopeRoot: workspaceRoot,
    review,
  });
  const finalized = finalizeAutonomyHealthReviewActions({
    currentProjection,
    scopeRoot: workspaceRoot,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    ),
    review,
    repositoryActions,
  });
  materializeAutonomyIssueProjection(workspaceRoot, finalized.projection);
  return finalized;
}

export function writeRuntimeHealthModuleLog(
  workspaceRoot: string,
  moduleName: string,
  lines: string[],
): void {
  const dir = join(workspaceRoot, ".kota", "modules", moduleName);
  mkdirSync(dir, { recursive: true });
  const timestamped = lines.map((line) =>
    JSON.stringify({
      ts: RUNTIME_HEALTH_AUDIT_NOW,
      ...(JSON.parse(line) as object),
    }),
  );
  writeFileSync(join(dir, "logs.jsonl"), `${timestamped.join("\n")}\n`, "utf-8");
}

export function runtimeHealthReadyTaskFiles(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, "data", "tasks", "ready");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md"));
}

export function staleWorkflowDispatchDeadLetter(
  overrides: {
    id?: string;
    workflow?: string;
    reason?: string;
    lastErrorClass?: DeadLetterItem["failure"]["lastErrorClass"];
    updatedAt?: string;
  } = {},
): DeadLetterItem {
  const id = overrides.id ?? "dlq-stale-1";
  const workflow = overrides.workflow ?? "builder";
  const updatedAt = overrides.updatedAt ?? "2026-06-17T08:00:00.000Z";
  return {
    id,
    type: "workflow-dispatch",
    status: "open",
    scopeId: "scope-a",
    owningModule: "workflow-runtime",
    sourceEventIds: ["evt-1"],
    affectedWorkflowNames: [workflow],
    failure: {
      reason: overrides.reason ?? "Payload failed validation for workflow dispatch",
      retryCount: 2,
      lastErrorClass: overrides.lastErrorClass ?? "validation",
      firstFailedAt: updatedAt,
      lastFailedAt: updatedAt,
    },
    source: {
      kind: "workflow-dispatch",
      workflowName: workflow,
      triggerEvent: "autonomy.queue.available",
      triggerSchemaRef: null,
      failedRunId: `run-${workflow}-failed`,
      runDir: `.kota/runs/run-${workflow}-failed`,
    },
    redrive: {
      kind: "workflow",
      workflowName: workflow,
      source: { kind: "run-trigger", runId: `run-${workflow}-failed` },
    },
    redactedProjection: {},
    createdAt: updatedAt,
    updatedAt,
    redriveAttempts: [],
    retention: { kind: "retain" },
  };
}

export function writeRuntimeHealthDeadLetterQueue(
  workspaceRoot: string,
  items: DeadLetterItem[],
): void {
  mkdirSync(join(workspaceRoot, ".kota", "dead-letter-queue"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, ".kota", "dead-letter-queue", "items.json"),
    JSON.stringify({ items }, null, 2),
    "utf-8",
  );
}

export function writeRuntimeHealthRun(
  workspaceRoot: string,
  args: {
    id: string;
    workflow: string;
    status: "interrupted" | "success";
    startedAt: string;
    error?: string;
  },
): void {
  const runDir = join(workspaceRoot, ".kota", "runs", args.id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify(
      {
        id: args.id,
        workflow: args.workflow,
        status: args.status,
        startedAt: args.startedAt,
        completedAt: args.startedAt,
        durationMs: 1000,
        steps: [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  if (args.error) writeFileSync(join(runDir, "error.txt"), args.error, "utf-8");
}
