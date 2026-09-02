import { describe, expect, it } from "vitest";
import { renderDashboard } from "./dashboard.js";
import {
  makeSnapshot,
  pendingRun,
  stripAnsi,
} from "./dashboard-test-support.js";

describe("renderDashboard status", () => {
  it("shows daemon header with pid and uptime", () => {
    const output = stripAnsi(renderDashboard(makeSnapshot(), []));
    expect(output).toContain("KOTA Daemon");
    expect(output).toContain("pid 12345");
    expect(output).toContain("running");
  });

  it("shows completed runs and session count", () => {
    const output = stripAnsi(renderDashboard(makeSnapshot(), []));
    expect(output).toContain("42");
    expect(output).toContain("Sessions  2");
  });

  it("shows definition count", () => {
    expect(stripAnsi(renderDashboard(makeSnapshot(), []))).toContain("Definitions  5");
  });

  it("never collides completed run count with the next label at high counts", () => {
    const output = stripAnsi(
      renderDashboard(makeSnapshot({ completedRuns: 12345678 }), []),
    );
    expect(output).toMatch(/Completed\s+12345678\s{2,}Sessions/);
  });

  it("shows stopping and stopped status", () => {
    expect(
      stripAnsi(renderDashboard(makeSnapshot({ stopping: true }), [])),
    ).toContain("stopping");
    expect(
      stripAnsi(renderDashboard(makeSnapshot({ running: false }), [])),
    ).toContain("stopped");
  });

  it("shows paused indicator when dispatch is paused", () => {
    const output = stripAnsi(
      renderDashboard(makeSnapshot({ dispatchPaused: true }), []),
    );
    expect(output).toMatch(/Paused\s+yes(\s|$)/m);
  });

  it("shows provider incidents instead of an idle state", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          agentOperatingState: {
            runtimeId: "agy:antigravity-cli",
            state: "provider-parked",
            reason: "provider authentication failed",
            resumeAt: "2026-09-02T18:00:00.000Z",
          },
        }),
        [],
      ),
    );
    expect(output).toContain("agy:antigravity-cli provider-parked until");
    expect(output).toContain("kota workflow resume --retry-agent");
    expect(output).not.toContain("idle; no queued or dispatchable work");
  });

  it("shows active runs with duration", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          activeRuns: [
            {
              runId: "run-1",
              workflow: "builder",
              startedAt: new Date(Date.now() - 90_000).toISOString(),
            },
          ],
        }),
        [],
      ),
    );
    expect(output).toContain("Active (1)");
    expect(output).toContain("builder");
    expect(output).toContain("1m 30s");
  });

  it("shows pending run count", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          pendingRuns: [
            pendingRun("builder"),
            pendingRun("explorer"),
            pendingRun("improver"),
          ],
        }),
        [],
      ),
    );
    expect(output).toContain("Pending");
    expect(output).toContain("3");
  });

  it("shows pending run names, trigger events, and readiness", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          pendingRuns: [pendingRun("improver", Date.now() - 1_000)],
        }),
        [],
      ),
    );
    expect(output).toContain("Pending (1)");
    expect(output).toContain("improver");
    expect(output).toContain("workflow.completed");
    expect(output).toContain("ready");
    expect(output).toContain("w8047d");
  });

  it("shows task queue context and omits zero-valued states", () => {
    const output = stripAnsi(
      renderDashboard(
        makeSnapshot({
          taskQueue: {
            inboxCount: 3,
            activeCount: 11,
            actionableCount: 2,
            dispatchableCount: 6,
            hasDispatchableWork: true,
            counts: {
              open: 8,
              blocked: 3,
              done: 100,
              dropped: 4,
            },
          },
        }),
        [],
      ),
    );
    expect(output).toContain("Work");
    expect(output).toContain("Inbox 3");
    expect(output).toContain("Open 8");
    expect(output).toContain("Dispatchable 6");
    expect(output).toContain("Actionable 2");
    expect(output).not.toMatch(/Done\s+100/);
  });
});
