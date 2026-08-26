import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { OwnerInterventionReport } from "./aggregate.js";
import type { DecisionAttributionRecord } from "./decision-attribution-types.js";
import { emptyOwnerInterventionReport } from "./owner-intervention-types.js";

export const NOW = "2026-04-29T12:00:00.000Z";

export function task(
  id: string,
  attrs: Partial<RepoTaskFullRecord> & { body: string },
): RepoTaskFullRecord {
  return {
    id,
    title: attrs.title ?? id,
    state: attrs.state ?? "done",
    priority: attrs.priority ?? "p2",
    area: attrs.area ?? "autonomy",
    taskClass: attrs.taskClass ?? "Platform",
    summary: attrs.summary ?? "",
    updatedAt: attrs.updatedAt ?? NOW,
    body: attrs.body,
    dependsOn: attrs.dependsOn ?? [],
    anchor: attrs.anchor ?? false,
  };
}

export function run(
  id: string,
  attrs: Partial<WorkflowRunMetadata> = {},
): WorkflowRunMetadata {
  return {
    id,
    workflow: attrs.workflow ?? "builder",
    definitionPath:
      attrs.definitionPath ?? "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: attrs.trigger ?? {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: attrs.startedAt ?? NOW,
    status: attrs.status ?? "success",
    runDir: attrs.runDir ?? `.kota/runs/${id}`,
    steps: attrs.steps ?? [],
    ...(attrs.completedAt !== undefined ? { completedAt: attrs.completedAt } : {}),
    ...(attrs.durationMs !== undefined ? { durationMs: attrs.durationMs } : {}),
    ...(attrs.totalCostUsd !== undefined ? { totalCostUsd: attrs.totalCostUsd } : {}),
  };
}

export function builderTrigger(taskId: string): WorkflowRunMetadata["trigger"] {
  const taskDigest = "0".repeat(64);
  return {
    event: "autonomy.queue.available",
    schemaRef: null,
    payload: {
      taskId,
      taskPath: `data/tasks/ready/${taskId}.md`,
      taskState: "ready",
      taskUpdatedAt: NOW,
      taskDigest,
      idempotencyKey: `builder:${taskId}:${taskDigest}`,
      title: taskId,
    },
  };
}

export function writeWriterIntegration(
  runsDir: string,
  runId: string,
  filesChanged: string[] = [],
): void {
  writeWriterIntegrationFixture(runsDir, {
    runId,
    workflow: "builder",
    publishedHead: `sha-${runId}`,
    commitSubject: "test commit",
    commitMessage: "test commit",
    changedPaths: filesChanged,
    completedAt: NOW,
  });
}

export function writeEvidence(runsDir: string, runId: string, name: string): void {
  const dir = join(runsDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "command: pnpm dev report\noutput\n", "utf-8");
}

export function ownerInterventions(
  records: OwnerInterventionReport["records"],
): OwnerInterventionReport {
  return {
    ...emptyOwnerInterventionReport(),
    totalQuestions: records.length,
    records,
  };
}

export function ownerRecord(
  questionId: string,
  attrs: Partial<OwnerInterventionReport["records"][number]>,
): OwnerInterventionReport["records"][number] {
  return {
    questionId,
    status: attrs.status ?? "answered",
    createdAt: attrs.createdAt ?? NOW,
    resolvedAt: attrs.resolvedAt ?? NOW,
    source: attrs.source ?? "test",
    originKind: attrs.originKind ?? "workflow",
    workflowName: attrs.workflowName ?? "builder",
    runId: attrs.runId ?? null,
    stepId: attrs.stepId ?? "ask-owner",
    taskId: attrs.taskId ?? null,
    answerBehavior: attrs.answerBehavior ?? "workflow-resume",
    outcomeBucket: attrs.outcomeBucket ?? "proposed-option",
    ageDays: attrs.ageDays ?? 0,
    refs: attrs.refs ?? {
      question: `owner-question:${questionId}`,
      workflow: attrs.workflowName ?? "builder",
      run: attrs.runId ? `run:${attrs.runId}` : null,
      task: attrs.taskId ? `task:${attrs.taskId}` : null,
    },
    markers: attrs.markers ?? [],
  };
}

export function recordByRun(
  records: readonly DecisionAttributionRecord[],
): Map<string, DecisionAttributionRecord> {
  return new Map(records.map((record) => [record.runId, record]));
}
