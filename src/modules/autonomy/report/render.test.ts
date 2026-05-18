import { describe, expect, it } from "vitest";
import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import type { AutonomyReportData } from "./aggregate.js";
import { renderAutonomyReport } from "./render.js";

const baseWindow = {
  windowStartedAt: "2026-04-22T12:00:00.000Z",
  windowEndedAt: "2026-04-29T12:00:00.000Z",
  windowDays: 7,
};

const empty: AutonomyReportData = {
  ...baseWindow,
  openQueue: { total: 0, byPriority: [], byArea: [], byState: [], waitingOnTasks: [] },
  doneInWindow: { total: 0, byPriority: [], byArea: [], byState: [], waitingOnTasks: [] },
  explorer: {
    totalRuns: 0,
    totalTaskAdditions: 0,
    unresolvedTaskAdditions: 0,
    byClassification: [
      { classification: "strategic", tasks: 0 },
      { classification: "fan-out", tasks: 0 },
      { classification: "other", tasks: 0 },
    ],
    taskAdditions: [],
  },
  builder: {
    totalCommittedRuns: 0,
    unresolvedClosures: 0,
    byArea: [],
    byPriority: [],
    byClassification: [],
    closures: [],
  },
  blockers: { totalBlocked: 0, byKind: [] },
  cost: {
    totalCostUsd: 0,
    finishedRuns: 0,
    averagePerFinishedRun: 0,
    byWorkflow: [],
  },
};

function render(data: AutonomyReportData): string {
  return renderToString(renderAutonomyReport(data), {
    width: 100,
    theme: NO_COLOR_THEME,
  });
}

describe("renderAutonomyReport", () => {
  it("renders all dimension headings even when data is empty", () => {
    const text = render(empty);
    expect(text).toContain("Autonomy report");
    expect(text).toContain("Open queue");
    expect(text).toContain("Tasks moved to done in window");
    expect(text).toContain("Explorer output");
    expect(text).toContain("Builder breakdown");
    expect(text).toContain("Blockers");
    expect(text).toContain("Cost");
  });

  it("emits placeholder lines when sections are empty", () => {
    const text = render(empty);
    expect(text).toContain("(none)");
    expect(text).toContain("(no explorer runs)");
    expect(text).toContain("(no builder commits)");
    expect(text).toContain("(no blocked tasks)");
    expect(text).toContain("(no finished runs in window)");
  });

  it("includes priority/area mix and explorer additions when populated", () => {
    const populated: AutonomyReportData = {
      ...empty,
      openQueue: {
        total: 3,
        byPriority: [
          { priority: "p1", count: 2 },
          { priority: "p2", count: 1 },
        ],
        byArea: [
          { area: "architecture", count: 2 },
          { area: "client", count: 1 },
        ],
        byState: [
          { state: "backlog", count: 2 },
          { state: "ready", count: 1 },
        ],
        waitingOnTasks: [
          {
            taskId: "task-waiting",
            title: "Waiting task",
            state: "ready",
            waitingOn: ["task-enabler"],
          },
        ],
      },
      explorer: {
        totalRuns: 1,
        totalTaskAdditions: 2,
        unresolvedTaskAdditions: 0,
        byClassification: [
          { classification: "strategic", tasks: 1 },
          { classification: "fan-out", tasks: 1 },
          { classification: "other", tasks: 0 },
        ],
        taskAdditions: [
          {
            runId: "r1",
            taskId: "task-arch",
            title: "Strategic refactor",
            area: "architecture",
            priority: "p1",
            classification: "strategic",
          },
          {
            runId: "r1",
            taskId: "task-client-fan",
            title: "Client surface",
            area: "client",
            priority: "p2",
            classification: "fan-out",
          },
        ],
      },
      builder: {
        totalCommittedRuns: 2,
        unresolvedClosures: 1,
        byArea: [
          { area: "architecture", commits: 1, totalCostUsd: 0.4 },
          { area: "client", commits: 1, totalCostUsd: 0.1 },
        ],
        byPriority: [
          { priority: "p1", commits: 1, totalCostUsd: 0.4 },
          { priority: "p2", commits: 1, totalCostUsd: 0.1 },
        ],
        byClassification: [
          { classification: "strategic", commits: 1, totalCostUsd: 0.4 },
          { classification: "fan-out", commits: 1, totalCostUsd: 0.1 },
          { classification: "other", commits: 0, totalCostUsd: 0 },
        ],
        closures: [],
      },
      blockers: {
        totalBlocked: 2,
        byKind: [
          { kind: "owner-decision", count: 1 },
          { kind: "operator-capture", count: 1 },
        ],
      },
      cost: {
        totalCostUsd: 0.5,
        finishedRuns: 2,
        averagePerFinishedRun: 0.25,
        byWorkflow: [
          {
            workflow: "builder",
            finishedRuns: 1,
            totalCostUsd: 0.4,
            averageCostUsd: 0.4,
          },
          {
            workflow: "explorer",
            finishedRuns: 1,
            totalCostUsd: 0.1,
            averageCostUsd: 0.1,
          },
        ],
      },
    };

    const text = render(populated);
    expect(text).toContain("Total: 3");
    expect(text).toContain("architecture");
    expect(text).toContain("client");
    expect(text).toContain("Strategic refactor");
    expect(text).toContain("Client surface");
    expect(text).toContain("$0.40");
    expect(text).toContain("$0.10");
    expect(text).toContain("owner-decision");
    expect(text).toContain("operator-capture");
    expect(text).toContain("task-waiting");
    expect(text).toContain("task-enabler");
    expect(text).toContain("could not be linked");
  });
});
