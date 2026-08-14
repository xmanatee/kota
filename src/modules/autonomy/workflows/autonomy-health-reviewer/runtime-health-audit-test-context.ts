import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import type { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

export const RUNTIME_HEALTH_AUDIT_NOW = "2026-06-19T12:00:00.000Z";

export function makeRuntimeHealthAuditProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-runtime-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  return projectDir;
}

export function reviewAndApplyRuntimeHealthAudit(
  projectDir: string,
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
) {
  const review = buildAutonomyHealthReviewFromSignals({
    signals: audit.signals,
    generatedAt: RUNTIME_HEALTH_AUDIT_NOW,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
  return applyAutonomyHealthReviewActions({ projectDir, review });
}

export function writeRuntimeHealthModuleLog(
  projectDir: string,
  moduleName: string,
  lines: string[],
): void {
  const dir = join(projectDir, ".kota", "modules", moduleName);
  mkdirSync(dir, { recursive: true });
  const timestamped = lines.map((line) =>
    JSON.stringify({
      ts: RUNTIME_HEALTH_AUDIT_NOW,
      ...(JSON.parse(line) as object),
    }),
  );
  writeFileSync(join(dir, "logs.jsonl"), `${timestamped.join("\n")}\n`, "utf-8");
}

export function runtimeHealthReadyTaskFiles(projectDir: string): string[] {
  const dir = join(projectDir, "data", "tasks", "ready");
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
    projectId: "scope-a",
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
  projectDir: string,
  items: DeadLetterItem[],
): void {
  mkdirSync(join(projectDir, ".kota", "dead-letter-queue"), { recursive: true });
  writeFileSync(
    join(projectDir, ".kota", "dead-letter-queue", "items.json"),
    JSON.stringify({ items }, null, 2),
    "utf-8",
  );
}

export function writeRuntimeHealthRun(
  projectDir: string,
  args: {
    id: string;
    workflow: string;
    status: "interrupted" | "success";
    startedAt: string;
    error?: string;
  },
): void {
  const runDir = join(projectDir, ".kota", "runs", args.id);
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
