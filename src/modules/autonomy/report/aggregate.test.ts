import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  materializeAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import { aggregateAutonomyReport } from "./aggregate.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function writeTask(
  workspaceRoot: string,
  state: RepoTaskState,
  id: string,
  attrs: {
    priority: string;
    title?: string;
    body?: string;
    dependsOn?: string[];
  },
): void {
  const dir = state === "done" || state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const title = attrs.title ?? id;
  const body = attrs.body ?? "## Problem\n\nTest body.\n";
  const dependencyLine = attrs.dependsOn
    ? `depends_on: [${attrs.dependsOn.join(", ")}]\n`
    : "";
  const content = state === "done" || state === "dropped"
    ? `---\nstatus: ${state}\n---\n\n# ${title}\n\n${body}`
    : `---\nstatus: ${state}\npriority: ${attrs.priority}\n${dependencyLine}---\n\n# ${title}\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

function writeRun(
  runsDir: string,
  id: string,
  metadata: Record<string, unknown>,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      definitionPath: `src/modules/autonomy/workflows/${metadata.workflow}/workflow.ts`,
      trigger: { event: "schedule", schemaRef: null, payload: {} },
      runDir: `.kota/runs/${id}`,
      ...metadata,
    }),
  );
}

function measuredAgentStep(usd: number) {
  const timestamp = new Date(NOW - MS_PER_DAY).toISOString();
  return {
    id: "agent",
    type: "agent" as const,
    status: "success" as const,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1,
    usage: {
      tokens: { state: "unknown" as const },
      cost: { state: "complete" as const, usd },
    },
  };
}

function writeWriterIntegration(
  runsDir: string,
  id: string,
  workflow: string,
  changedPaths: readonly string[] = [],
): void {
  writeFileSync(
    join(runsDir, id, "writer-integration.json"),
    JSON.stringify({
      version: 1,
      runId: id,
      workflow,
      scopeId: "test-scope",
      targetBranch: "main",
      baseHead: "base",
      integratedFromHead: "base",
      publishedHead: "abc",
      commitSubject: "x",
      commitMessage: "x",
      changedPaths,
      completedAt: new Date(NOW).toISOString(),
    }),
  );
}

function builderTrigger(taskId: string, title: string) {
  const taskDigest = "0".repeat(64);
  return {
    event: "autonomy.queue.available",
    schemaRef: null,
    payload: {
      taskId,
      taskPath: `data/tasks/${taskId}.md`,
      taskState: "open",
      taskDigest,
      idempotencyKey: `builder:${taskId}:${taskDigest}`,
      title,
    },
  };
}

function writeTrajectoryDiagnostics(
  runsDir: string,
  runId: string,
  stepId: string,
): void {
  const stepsDir = join(runsDir, runId, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, `${stepId}.trajectory-diagnostics.json`),
    JSON.stringify({
      version: 1,
      status: "supported",
      emitsAgentMessageStream: true,
      counts: {
        warningCount: 1,
        unsupportedTrajectoryCount: 0,
        missingStreamingFramesCount: 0,
        missingFinalVerificationAfterEditCount: 1,
        repeatedIdenticalFailingCommandCount: 0,
        editAfterSuccessfulVerificationCount: 0,
        longPreambleWithoutTaskTouchCount: 0,
      },
      diagnostics: [
        {
          code: "missing_final_verification_after_edit",
          severity: "warning",
          summary: "A file-editing action was not followed by verification.",
          frameIndexes: [4],
          details: ["lastEditFrame=4", "lastEditTool=apply_patch"],
        },
      ],
    }),
  );
}

function writeUnsupportedTrajectoryDiagnostics(
  runsDir: string,
  runId: string,
  stepId: string,
): void {
  const stepsDir = join(runsDir, runId, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, `${stepId}.trajectory-diagnostics.json`),
    JSON.stringify({
      version: 1,
      status: "unsupported",
      emitsAgentMessageStream: false,
      counts: {
        warningCount: 1,
        unsupportedTrajectoryCount: 1,
        missingStreamingFramesCount: 0,
        missingFinalVerificationAfterEditCount: 0,
        repeatedIdenticalFailingCommandCount: 0,
        editAfterSuccessfulVerificationCount: 0,
        longPreambleWithoutTaskTouchCount: 0,
      },
      diagnostics: [
        {
          code: "unsupported_trajectory",
          severity: "warning",
          summary:
            "Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.",
          frameIndexes: [],
          details: ["capability.emitsAgentMessageStream=false"],
        },
      ],
    }),
  );
}

describe("aggregateAutonomyReport", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `autonomy-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("aggregates active queue priority and state mix", () => {
    writeTask(workspaceRoot, "open", "task-arch-1", { priority: "p1" });
    writeTask(workspaceRoot, "open", "task-client-1", {
      priority: "p2",
    });
    writeTask(workspaceRoot, "open", "task-modules-1", {
      priority: "p1",
    });
    writeTask(workspaceRoot, "open", "task-active-1", {
      priority: "p2",
    });
    writeTask(workspaceRoot, "blocked", "task-blocked-1", {
      priority: "p1",
      body: "## Blocked on\n\nkind: owner-decision\nslot: a\nquestion: Q?\n",
    });
    writeTask(workspaceRoot, "done", "task-done-old", {
      priority: "p2",
    });

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.openQueue.total).toBe(5);
    expect(report.openQueue.byPriority).toEqual([
      { priority: "p1", count: 3 },
      { priority: "p2", count: 2 },
    ]);
    expect(report.openQueue.byState).toEqual([
      { state: "blocked", count: 1 },
      { state: "open", count: 4 },
    ]);
    expect(report.doneInWindow.total).toBe(0);
  });

  it("surfaces open tasks waiting on hard predecessor task ids", () => {
    writeTask(workspaceRoot, "open", "task-dependent", {
      priority: "p2",
      dependsOn: ["task-enabler"],
    });
    writeTask(workspaceRoot, "open", "task-enabler", {
      priority: "p2",
    });

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.openQueue.waitingOnTasks).toEqual([
      {
        taskId: "task-dependent",
        title: "task-dependent",
        state: "open",
        waitingOn: ["task-enabler"],
      },
    ]);
  });

  it("includes archived done tasks completed by builder runs in the window", () => {
    writeTask(workspaceRoot, "done", "task-done-recent", {
      priority: "p2",
    });
    writeTask(workspaceRoot, "done", "task-done-old", {
      priority: "p2",
    });
    const builderRunId = "2026-04-28T09-00-00-000Z-builder-done";
    writeRun(runsDir, builderRunId, {
      workflow: "builder",
      trigger: builderTrigger("task-done-recent", "Recent task"),
      startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      steps: [],
    });
    writeWriterIntegration(runsDir, builderRunId, "builder", [
      "data/tasks/archive/task-done-recent.md",
    ]);

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.doneInWindow.total).toBe(1);
    expect(report.doneInWindow.byPriority).toEqual([{ priority: "unknown", count: 1 }]);
  });

  it("reports explorer task additions without inferred classifications", () => {
    writeTask(workspaceRoot, "open", "task-strategic-add", {
      priority: "p1",
    });
    writeTask(workspaceRoot, "open", "task-fanout-add", {
      priority: "p2",
    });

    const explorerRunId = "2026-04-28T08-00-00-000Z-explorer-aaa";
    writeRun(runsDir, explorerRunId, {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.5 },
      },
      steps: [measuredAgentStep(0.5)],
    });
    writeWriterIntegration(runsDir, explorerRunId, "explorer", [
      "data/tasks/task-strategic-add.md",
      "data/tasks/task-fanout-add.md",
      "data/tasks/task-missing.md",
    ]);

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.explorer.totalRuns).toBe(1);
    expect(report.explorer.totalTaskAdditions).toBe(2);
    expect(report.explorer.unresolvedTaskAdditions).toBe(1);
    expect(report.explorer.taskAdditions.map((addition) => addition.taskId)).toEqual([
      "task-strategic-add",
      "task-fanout-add",
    ]);
  });

  it("uses runtime integration evidence when explorer output omits addedTaskFiles", () => {
    writeTask(workspaceRoot, "open", "task-explorer-fallback", {
      priority: "p1",
    });

    const explorerRunId = "2026-04-28T08-30-00-000Z-explorer-bbb";
    writeRun(runsDir, explorerRunId, {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.5 },
      },
      steps: [measuredAgentStep(0.5)],
    });
    writeWriterIntegration(runsDir, explorerRunId, "explorer", [
      "data/tasks/task-explorer-fallback.md",
      "src/modules/autonomy/report/aggregate.ts",
    ]);

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.explorer.totalTaskAdditions).toBe(1);
    expect(report.explorer.taskAdditions[0]?.taskId).toBe(
      "task-explorer-fallback",
    );
    expect(report.explorer.taskAdditions[0]?.priority).toBe("p1");
  });

  it("links builder commits to archived tasks", () => {
    writeTask(workspaceRoot, "done", "task-builder-arch", {
      priority: "p1",
    });
    writeTask(workspaceRoot, "done", "task-builder-client", {
      priority: "p2",
    });

    const archRunId = "2026-04-28T09-00-00-000Z-builder-bbb";
    writeRun(runsDir, archRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.4 },
      },
      trigger: builderTrigger("task-builder-arch", "Arch task"),
      steps: [measuredAgentStep(0.4)],
    });
    writeWriterIntegration(runsDir, archRunId, "builder");

    const clientRunId = "2026-04-28T10-00-00-000Z-builder-ccc";
    writeRun(runsDir, clientRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.1 },
      },
      trigger: builderTrigger("task-builder-client", "Client task"),
      steps: [],
    });
    writeWriterIntegration(runsDir, clientRunId, "builder");

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.builder.totalCommittedRuns).toBe(2);
    expect(report.builder.byPriority).toEqual([
      {
        priority: "unknown",
        commits: 2,
        measuredCostRuns: 2,
        unavailableCostRuns: 0,
        unknownCostRuns: 0,
        totalCostUsd: 0.5,
      },
    ]);
  });

  it("counts unresolved builder closures when integration evidence or task is missing", () => {
    const orphanRunId = "2026-04-28T11-00-00-000Z-builder-ddd";
    writeRun(runsDir, orphanRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.05 },
      },
      steps: [],
    });
    // No writer integration evidence written.

    const ghostRunId = "2026-04-28T12-00-00-000Z-builder-eee";
    writeRun(runsDir, ghostRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.05 },
      },
      trigger: builderTrigger("task-no-such-task", "Ghost task"),
      steps: [],
    });
    writeWriterIntegration(runsDir, ghostRunId, "builder");

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.builder.totalCommittedRuns).toBe(0);
    expect(report.builder.unresolvedClosures).toBe(2);
  });

  it("groups blockers by precondition kind", () => {
    writeTask(workspaceRoot, "blocked", "task-owner", {
      priority: "p1",
      body: "## Blocked on\n\nkind: owner-decision\nslot: foo\nquestion: Want this?\n",
    });
    writeTask(workspaceRoot, "blocked", "task-capture", {
      priority: "p2",
      body: "## Blocked on\n\nkind: operator-capture\npath: .kota/runs/screenshot.png\ndescription: capture\n",
    });
    writeTask(workspaceRoot, "blocked", "task-missing-section", {
      priority: "p2",
      body: "## Problem\n\nNo precondition section.\n",
    });

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.blockers.totalBlocked).toBe(3);
    const byKind = Object.fromEntries(
      report.blockers.byKind.map((r) => [r.kind, r.count]),
    );
    expect(byKind).toEqual({
      "owner-decision": 1,
      "operator-capture": 1,
      "missing-section": 1,
    });
  });

  it("surfaces top active recurring trajectory-diagnostic patterns", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      const runId = `2026-04-28T${String(hour).padStart(2, "0")}-00-00-000Z-builder-td${index}`;
      writeRun(runsDir, runId, {
        workflow: "builder",
        startedAt: new Date(NOW - (4 - index) * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(NOW - (4 - index) * 60 * 60 * 1000 + 1000).toISOString(),
        status: "success",
        durationMs: 1000,
        steps: [],
      });
      writeTrajectoryDiagnostics(runsDir, runId, "build");
    }

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.trajectoryDiagnostics.activePatterns).toHaveLength(1);
    expect(report.trajectoryDiagnostics.activePatterns[0]).toMatchObject({
      workflow: "builder",
      stepId: "build",
      code: "missing_final_verification_after_edit",
      runCount: 3,
    });
    expect(
      JSON.stringify(report.trajectoryDiagnostics.activePatterns[0]),
    ).not.toMatch(/cost|throughput/i);
  });

  it("omits repeated unsupported explorer capability artifacts from active report patterns", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      const runId = `2026-04-28T${String(hour).padStart(2, "0")}-00-00-000Z-explorer-td${index}`;
      writeRun(runsDir, runId, {
        workflow: "explorer",
        startedAt: new Date(NOW - (4 - index) * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(NOW - (4 - index) * 60 * 60 * 1000 + 1000).toISOString(),
        status: "success",
        durationMs: 1000,
        steps: [],
      });
      writeUnsupportedTrajectoryDiagnostics(runsDir, runId, "explore");
    }

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.trajectoryDiagnostics.activePatterns).toEqual([]);
    expect(JSON.stringify(report.trajectoryDiagnostics)).not.toContain(
      "trajectory-diagnostic:explorer:explore:unsupported_trajectory",
    );
  });

  it("aggregates autonomy health review counts by severity, label, scope, source, and actionability", () => {
    const observation = buildAutonomyIssueObservation({
      kind: "present",
      rootCauseKey: "workflow:builder:runtime-warning",
      observedAt: new Date(NOW - MS_PER_DAY).toISOString(),
      signalIds: ["health-builder-warning"],
      source: { kind: "workflow", id: "builder" },
      severity: "warning",
      labels: ["runtime", "tool-friction"],
      actionability: "local-code",
      summaries: [],
      evidenceRefs: [
        { kind: "run", ref: ".kota/runs/builder-warning/metadata.json" },
      ],
      observationCount: 2,
    });
    const projected = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [observation],
    }).projection;
    materializeAutonomyIssueProjection(workspaceRoot, recordAutonomyIssueDispositions({
      current: projected,
      updates: [
        {
          issueKey: observation.issueKey,
          kind: "task",
          decidedAt: new Date(NOW - MS_PER_DAY + 1).toISOString(),
          taskIds: ["task-health-workflow-builder-runtime-warning"],
          ownerQuestionIds: [],
        },
      ],
    }));

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.health.totalSignals).toBe(2);
    expect(report.health.totalGroups).toBe(1);
    expect(report.health.bySeverity).toEqual([{ severity: "warning", count: 2 }]);
    expect(report.health.byLabel).toEqual([
      { label: "runtime", count: 2 },
      { label: "tool-friction", count: 2 },
    ]);
    expect(report.health.byScope).toEqual([{ scope: "scope", count: 2 }]);
    expect(report.health.bySource).toEqual([
      { source: "workflow:builder", count: 2 },
    ]);
    expect(report.health.byActionability).toEqual([
      { actionability: "local-code", count: 2 },
    ]);
    expect(report.health.byStatus).toEqual([{ status: "open", count: 1 }]);
  });

  it("breaks cost down by workflow over the window", () => {
    writeRun(runsDir, "2026-04-28T13-00-00-000Z-builder-fff", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.20 },
      },
      durationMs: 1,
      steps: [measuredAgentStep(0.20)],
    });
    writeRun(runsDir, "2026-04-28T14-00-00-000Z-explorer-ggg", {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.10 },
      },
      durationMs: 1,
      steps: [measuredAgentStep(0.10)],
    });
    writeRun(runsDir, "2026-04-28T15-00-00-000Z-builder-hhh", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.30 },
      },
      durationMs: 1,
      steps: [measuredAgentStep(0.30)],
    });
    writeRun(runsDir, "2026-04-28T15-30-00-000Z-builder-iii", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "running",
      durationMs: 1,
      steps: [],
    });

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.cost.finishedRuns).toBe(3);
    expect(report.cost.totalCostUsd).toBeCloseTo(0.60);
    expect(report.cost.byWorkflow[0]).toEqual({
      workflow: "builder",
      finishedRuns: 2,
      measuredRuns: 2,
      unavailableRuns: 0,
      unknownRuns: 0,
      totalCostUsd: 0.50,
      averageMeasuredCostUsd: 0.25,
    });
    expect(report.cost.byWorkflow[1]).toEqual({
      workflow: "explorer",
      finishedRuns: 1,
      measuredRuns: 1,
      unavailableRuns: 0,
      unknownRuns: 0,
      totalCostUsd: 0.10,
      averageMeasuredCostUsd: 0.10,
    });
  });
});
