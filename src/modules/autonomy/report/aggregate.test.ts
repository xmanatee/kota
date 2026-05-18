import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregateAutonomyReport } from "./aggregate.js";
import { classifyTaskShape } from "./task-classification.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function writeTask(
  projectDir: string,
  state: string,
  id: string,
  attrs: {
    priority: string;
    area: string;
    title?: string;
    updatedAt?: string;
    body?: string;
    dependsOn?: string[];
  },
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const updatedAt = attrs.updatedAt ?? new Date(NOW).toISOString();
  const title = attrs.title ?? id;
  const body = attrs.body ?? "## Problem\n\nTest body.\n";
  const dependencyLine = attrs.dependsOn
    ? `depends_on: [${attrs.dependsOn.join(", ")}]\n`
    : "";
  const content =
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${state}\npriority: ${attrs.priority}\n` +
    `area: ${attrs.area}\nsummary: t\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n` +
    `${dependencyLine}---\n\n${body}`;
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
      trigger: { event: "schedule", payload: {} },
      runDir: `.kota/runs/${id}`,
      ...metadata,
    }),
  );
}

function writeRunSummary(
  runsDir: string,
  id: string,
  summary: Record<string, unknown>,
): void {
  writeFileSync(
    join(runsDir, id, "run-summary.json"),
    JSON.stringify({
      runId: id,
      workflow: "builder",
      taskId: null,
      taskTitle: null,
      outcome: "success",
      commitSha: "abc",
      commitMessage: "x",
      filesChanged: [],
      costUsd: null,
      durationMs: null,
      completedAt: new Date(NOW).toISOString(),
      ...summary,
    }),
  );
}

describe("classifyTaskShape", () => {
  const shape = (area: string, title = "", summary = "") =>
    classifyTaskShape({ area, title, summary });

  it("buckets architecture/core/modules/autonomy as strategic when no surface markers appear", () => {
    expect(shape("architecture", "Split ModuleContext into capability contexts")).toBe(
      "strategic",
    );
    expect(shape("core", "Tighten daemon control protocol")).toBe("strategic");
    expect(shape("modules", "Move shell helpers into the execution module")).toBe(
      "strategic",
    );
    expect(shape("autonomy", "Add critic runtime probe protocol")).toBe("strategic");
  });

  it("buckets client/channel as fan-out", () => {
    expect(shape("client", "Anything")).toBe("fan-out");
    expect(shape("channel", "Anything")).toBe("fan-out");
  });

  it("demotes non-client area to fan-out when title carries surface-parity markers", () => {
    expect(
      shape(
        "modules",
        "Replace macOS workflow trigger text entry with definitions picker",
      ),
    ).toBe("fan-out");
    expect(
      shape("architecture", "Split large client protocol and state files"),
    ).toBe("fan-out");
    expect(
      shape("autonomy", "Add web ui run comparison view for spotting regressions"),
    ).toBe("fan-out");
    expect(
      shape("modules", "Wire up the dashboard for daemon health"),
    ).toBe("fan-out");
  });

  it("buckets unknown / non-strategic areas as other", () => {
    expect(shape("operator-ux", "Some operator polish")).toBe("other");
    expect(shape("research", "Read upstream paper")).toBe("other");
    expect(shape("", "")).toBe("other");
  });

  it("normalizes whitespace and case", () => {
    expect(shape("  Architecture ", "Refactor")).toBe("strategic");
    expect(shape("MODULES", "Replace the macOS picker")).toBe("fan-out");
  });
});

describe("aggregateAutonomyReport", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `autonomy-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("aggregates open queue priority and area mix", () => {
    writeTask(projectDir, "backlog", "task-arch-1", { priority: "p1", area: "architecture" });
    writeTask(projectDir, "backlog", "task-client-1", { priority: "p2", area: "client" });
    writeTask(projectDir, "ready", "task-modules-1", { priority: "p1", area: "modules" });
    writeTask(projectDir, "doing", "task-doing-1", { priority: "p2", area: "client" });
    writeTask(projectDir, "blocked", "task-blocked-1", {
      priority: "p1",
      area: "architecture",
      body: "## Unblock Precondition\n\nkind: owner-decision\nslot: a\nquestion: Q?\n",
    });
    writeTask(projectDir, "done", "task-done-old", {
      priority: "p2",
      area: "modules",
      updatedAt: new Date(NOW - 30 * MS_PER_DAY).toISOString(),
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.openQueue.total).toBe(5);
    expect(report.openQueue.byPriority).toEqual([
      { priority: "p1", count: 3 },
      { priority: "p2", count: 2 },
    ]);
    const byArea = Object.fromEntries(
      report.openQueue.byArea.map((r) => [r.area, r.count]),
    );
    expect(byArea).toEqual({ architecture: 2, client: 2, modules: 1 });
    expect(report.doneInWindow.total).toBe(0);
  });

  it("surfaces open tasks waiting on hard predecessor task ids", () => {
    writeTask(projectDir, "ready", "task-dependent", {
      priority: "p2",
      area: "modules",
      dependsOn: ["task-enabler"],
    });
    writeTask(projectDir, "backlog", "task-enabler", {
      priority: "p2",
      area: "modules",
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.openQueue.waitingOnTasks).toEqual([
      {
        taskId: "task-dependent",
        title: "task-dependent",
        state: "ready",
        waitingOn: ["task-enabler"],
      },
    ]);
  });

  it("includes done tasks updated within the window", () => {
    writeTask(projectDir, "done", "task-done-recent", {
      priority: "p2",
      area: "modules",
      updatedAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });
    writeTask(projectDir, "done", "task-done-old", {
      priority: "p2",
      area: "modules",
      updatedAt: new Date(NOW - 30 * MS_PER_DAY).toISOString(),
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.doneInWindow.total).toBe(1);
    expect(report.doneInWindow.byPriority).toEqual([{ priority: "p2", count: 1 }]);
  });

  it("classifies explorer task additions by area", () => {
    writeTask(projectDir, "backlog", "task-strategic-add", {
      priority: "p1",
      area: "architecture",
    });
    writeTask(projectDir, "backlog", "task-fanout-add", {
      priority: "p2",
      area: "client",
    });

    const explorerRunId = "2026-04-28T08-00-00-000Z-explorer-aaa";
    writeRun(runsDir, explorerRunId, {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      totalCostUsd: 0.5,
      steps: [
        {
          id: "commit",
          type: "code",
          status: "success",
          startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
          completedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
          durationMs: 100,
          output: {
            committed: true,
            addedTaskFiles: [
              "data/tasks/backlog/task-strategic-add.md",
              "data/tasks/backlog/task-fanout-add.md",
              "data/tasks/backlog/task-missing.md",
            ],
          },
        },
      ],
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.explorer.totalRuns).toBe(1);
    expect(report.explorer.totalTaskAdditions).toBe(2);
    expect(report.explorer.unresolvedTaskAdditions).toBe(1);
    const counts = Object.fromEntries(
      report.explorer.byClassification.map((r) => [r.classification, r.tasks]),
    );
    expect(counts).toEqual({ strategic: 1, "fan-out": 1, other: 0 });
  });

  it("falls back to addedFilesBySha when explorer output omits addedTaskFiles", () => {
    writeTask(projectDir, "backlog", "task-explorer-fallback", {
      priority: "p1",
      area: "modules",
    });

    const explorerRunId = "2026-04-28T08-30-00-000Z-explorer-bbb";
    writeRun(runsDir, explorerRunId, {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      totalCostUsd: 0.5,
      steps: [
        {
          id: "commit",
          type: "code",
          status: "success",
          startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
          completedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
          durationMs: 100,
          // Older shape: only sha + committed flag, no addedTaskFiles inline.
          output: { committed: true, sha: "deadbeef" },
        },
      ],
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
      addedFilesBySha: new Map([
        [
          "deadbeef",
          [
            "data/tasks/backlog/task-explorer-fallback.md",
            "src/modules/autonomy/run-summary.ts",
          ],
        ],
      ]),
    });

    expect(report.explorer.totalTaskAdditions).toBe(1);
    expect(report.explorer.taskAdditions[0]?.taskId).toBe(
      "task-explorer-fallback",
    );
    expect(report.explorer.taskAdditions[0]?.classification).toBe("strategic");
  });

  it("links builder commits to task area and priority", () => {
    writeTask(projectDir, "done", "task-builder-arch", {
      priority: "p1",
      area: "architecture",
      updatedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
    });
    writeTask(projectDir, "done", "task-builder-client", {
      priority: "p2",
      area: "client",
      updatedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
    });

    const archRunId = "2026-04-28T09-00-00-000Z-builder-bbb";
    writeRun(runsDir, archRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      totalCostUsd: 0.4,
      steps: [],
    });
    writeRunSummary(runsDir, archRunId, {
      taskId: "task-builder-arch",
      taskTitle: "Arch task",
    });

    const clientRunId = "2026-04-28T10-00-00-000Z-builder-ccc";
    writeRun(runsDir, clientRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1000,
      totalCostUsd: 0.1,
      steps: [],
    });
    writeRunSummary(runsDir, clientRunId, {
      taskId: "task-builder-client",
      taskTitle: "Client task",
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.builder.totalCommittedRuns).toBe(2);
    expect(report.builder.byArea).toEqual([
      { area: "architecture", commits: 1, totalCostUsd: 0.4 },
      { area: "client", commits: 1, totalCostUsd: 0.1 },
    ]);
    const byClass = Object.fromEntries(
      report.builder.byClassification.map((r) => [r.classification, r]),
    );
    expect(byClass.strategic.commits).toBe(1);
    expect(byClass["fan-out"].commits).toBe(1);
    expect(byClass.strategic.totalCostUsd).toBeCloseTo(0.4);
    expect(byClass["fan-out"].totalCostUsd).toBeCloseTo(0.1);
  });

  it("counts unresolved builder closures when run-summary or task is missing", () => {
    const orphanRunId = "2026-04-28T11-00-00-000Z-builder-ddd";
    writeRun(runsDir, orphanRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1,
      totalCostUsd: 0.05,
      steps: [],
    });
    // No run-summary written.

    const ghostRunId = "2026-04-28T12-00-00-000Z-builder-eee";
    writeRun(runsDir, ghostRunId, {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      durationMs: 1,
      totalCostUsd: 0.05,
      steps: [],
    });
    writeRunSummary(runsDir, ghostRunId, { taskId: "task-no-such-task" });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });

    expect(report.builder.totalCommittedRuns).toBe(0);
    expect(report.builder.unresolvedClosures).toBe(2);
  });

  it("groups blockers by precondition kind", () => {
    writeTask(projectDir, "blocked", "task-owner", {
      priority: "p1",
      area: "architecture",
      body: "## Unblock Precondition\n\nkind: owner-decision\nslot: foo\nquestion: Want this?\n",
    });
    writeTask(projectDir, "blocked", "task-capture", {
      priority: "p2",
      area: "client",
      body: "## Unblock Precondition\n\nkind: operator-capture\npath: .kota/runs/screenshot.png\ndescription: capture\n",
    });
    writeTask(projectDir, "blocked", "task-task-done", {
      priority: "p2",
      area: "core",
      body: "## Unblock Precondition\n\nkind: task-done\nref: task-other\n",
    });
    writeTask(projectDir, "blocked", "task-missing-section", {
      priority: "p2",
      area: "core",
      body: "## Problem\n\nNo precondition section.\n",
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.blockers.totalBlocked).toBe(4);
    const byKind = Object.fromEntries(
      report.blockers.byKind.map((r) => [r.kind, r.count]),
    );
    expect(byKind).toEqual({
      "task-done": 1,
      "owner-decision": 1,
      "operator-capture": 1,
      "missing-section": 1,
    });
  });

  it("breaks cost down by workflow over the window", () => {
    writeRun(runsDir, "2026-04-28T13-00-00-000Z-builder-fff", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      totalCostUsd: 0.20,
      durationMs: 1,
      steps: [],
    });
    writeRun(runsDir, "2026-04-28T14-00-00-000Z-explorer-ggg", {
      workflow: "explorer",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      totalCostUsd: 0.10,
      durationMs: 1,
      steps: [],
    });
    writeRun(runsDir, "2026-04-28T15-00-00-000Z-builder-hhh", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "success",
      totalCostUsd: 0.30,
      durationMs: 1,
      steps: [],
    });
    writeRun(runsDir, "2026-04-28T15-30-00-000Z-builder-iii", {
      workflow: "builder",
      startedAt: new Date(NOW - 1 * MS_PER_DAY).toISOString(),
      status: "running",
      durationMs: 1,
      steps: [],
    });

    const report = aggregateAutonomyReport({
      projectDir,
      runsDir,
      windowEndMs: NOW,
      windowDays: 7,
    });
    expect(report.cost.finishedRuns).toBe(3);
    expect(report.cost.totalCostUsd).toBeCloseTo(0.60);
    expect(report.cost.byWorkflow[0]).toEqual({
      workflow: "builder",
      finishedRuns: 2,
      totalCostUsd: 0.50,
      averageCostUsd: 0.25,
    });
    expect(report.cost.byWorkflow[1]).toEqual({
      workflow: "explorer",
      finishedRuns: 1,
      totalCostUsd: 0.10,
      averageCostUsd: 0.10,
    });
  });
});
