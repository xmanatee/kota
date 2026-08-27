import { describe, expect, it } from "vitest";
import {
  type DashboardSnapshot,
  renderDashboard,
} from "./dashboard.js";
import { stripAnsi } from "./dashboard-test-support.js";

describe("renderDashboard owner transcript regression", () => {
  const fixtureSnapshot: DashboardSnapshot = {
    pid: 54321,
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
    running: true,
    stopping: false,
    completedRuns: 668,
    activeRuns: [],
    pendingRuns: [],
    dispatchPaused: false,
    definitionCount: 14,
    sessionCount: 1,
    lastCompletedWorkflow: "builder",
    lastCompletedAt: new Date(Date.now() - 120_000).toISOString(),
    lastCompletedStatus: "success",
    taskQueue: {
      inboxCount: 0,
      activeCount: 8,
      actionableCount: 1,
      dispatchableCount: 1,
      hasDispatchableWork: true,
      counts: {
        open: 1,
        blocked: 7,
        done: 668,
        dropped: 17,
      },
    },
  };
  const fixtureLogs = [
    "Daemon ready (pid 54321): 14 workflows, 0 scheduled items, poll 30s",
    "[dispatch] runtime.idle: checking queue",
    "[dispatch] no eligible workflow",
    "[heartbeat] 30s elapsed",
  ];

  for (const width of [80, 120, 160]) {
    it(`renders cleanly at ${width} columns`, () => {
      const output = stripAnsi(
        renderDashboard(fixtureSnapshot, fixtureLogs, { width }),
      );
      expect(output).toMatch(/Completed\s+668\s{2,}Sessions/);
      expect(output).toMatch(/Definitions\s+14/);
      expect(output.match(/KOTA Daemon/g) ?? []).toHaveLength(1);
      expect(output).toContain("Work");
      expect(output).toMatch(/Open\s+1/);
      expect(output).toMatch(/Blocked\s+7/);
      expect(output).not.toMatch(/Done\s+668/);
      expect(output).not.toMatch(/Dropped\s+17/);
      const activityLine = output
        .split("\n")
        .find((line) => line.trim().startsWith("Activity "));
      expect(activityLine, `width=${width}`).toBeDefined();
      expect(activityLine!.length).toBe(width);
      const activityIndex = output.indexOf("Activity ");
      expect(activityIndex).toBeGreaterThan(output.indexOf("State"));
      expect(activityIndex).toBeLessThan(output.indexOf("Daemon ready"));
    });
  }
});
