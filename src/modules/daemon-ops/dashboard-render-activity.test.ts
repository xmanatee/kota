import { describe, expect, it } from "vitest";
import {
  type DashboardTaskQueue,
  renderDashboard,
} from "./dashboard.js";
import { makeSnapshot, stripAnsi } from "./dashboard-test-support.js";

describe("renderDashboard activity", () => {
  it("skips the Work section entirely when the task queue has no open signal", () => {
    const emptyQueue: DashboardTaskQueue = {
      inboxCount: 0,
      openCount: 0,
      pullableCount: 0,
      actionableCount: 0,
      promotableBacklogCount: 0,
      dispatchableCount: 0,
      hasDispatchableWork: false,
      counts: {
        backlog: 0,
        ready: 0,
        doing: 0,
        blocked: 0,
        done: 500,
        dropped: 10,
      },
    };
    const output = stripAnsi(
      renderDashboard(makeSnapshot({ taskQueue: emptyQueue }), []),
    );
    expect(output).not.toContain("Work");
  });

  it("does not report parked open tasks as dispatchable work", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          taskQueue: {
            inboxCount: 0,
            openCount: 15,
            pullableCount: 5,
            actionableCount: 0,
            promotableBacklogCount: 0,
            dispatchableCount: 0,
            hasDispatchableWork: false,
            counts: {
              backlog: 7,
              ready: 0,
              doing: 0,
              blocked: 8,
              done: 1411,
              dropped: 23,
            },
          },
        }),
        [],
      ),
    );
    expect(output).toContain("open work parked; no dispatchable tasks");
    expect(output).not.toContain("work available; waiting for idle dispatch");
    expect(output).toContain("Dispatchable 0");
    expect(output).toContain("Promotable 0");
    expect(output).toContain("Pullable 5");
  });

  it("shows last completed workflow", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          lastCompletedWorkflow: "sorter",
          lastCompletedAt: new Date(Date.now() - 300_000).toISOString(),
          lastCompletedStatus: "success",
        }),
        [],
      ),
    );
    expect(output).toContain("Last");
    expect(output).toContain("sorter");
    expect(output).toContain("success");
    expect(output).toContain("5m ago");
  });

  it("shows log messages after a labeled activity rule", () => {
    const logs = ["Daemon starting...", "Control API on http://127.0.0.1:8080"];
    const output = stripAnsi(renderDashboard(makeSnapshot(), logs));
    expect(output).toContain(logs[0]);
    expect(output).toContain(logs[1]);
    const activityIndex = output.indexOf("Activity ");
    expect(activityIndex).toBeGreaterThan(output.indexOf("KOTA Daemon"));
    expect(activityIndex).toBeLessThan(output.indexOf(logs[0]));
  });

  it("does not render decorative dashes that look like a second frame", () => {
    const lines = stripAnsi(renderDashboard(makeSnapshot(), [])).split("\n");
    for (const line of lines) {
      if (/^\u2500{20,}$/.test(line.trim())) {
        throw new Error(`unexpected decorative rule line: "${line}"`);
      }
    }
  });

  it("shows cost and a single-cell paused indicator", () => {
    expect(
      stripAnsi(renderDashboard(makeSnapshot({ totalCostUsd: 12.5 }), [])),
    ).toContain("$12.50");
    expect(
      stripAnsi(renderDashboard(makeSnapshot({ dispatchPaused: true }), [])),
    ).toMatch(/Paused\s+yes(\s|$)/m);
  });

  it("truncates logs to 20 lines", () => {
    const logs = Array.from({ length: 30 }, (_, index) => `log line ${index}`);
    const output = stripAnsi(renderDashboard(makeSnapshot(), logs));
    expect(output).not.toContain("log line 0");
    expect(output).toContain("log line 29");
  });

  it("activity rule fills each common terminal width", () => {
    for (const width of [80, 120, 160]) {
      const output = stripAnsi(
        renderDashboard(makeSnapshot(), ["Daemon starting..."], { width }),
      );
      const activityLine = output
        .split("\n")
        .find((line) => line.trim().startsWith("Activity "));
      expect(activityLine, `width=${width}`).toBeDefined();
      expect(activityLine!.length).toBe(width);
      expect(activityLine!.endsWith("─")).toBe(true);
    }
  });
});
