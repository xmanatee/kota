import { describe, expect, it, vi } from "vitest";
import { buildStatusText } from "./status-render.js";
import type { StatusInfo } from "./status-types.js";

vi.mock("#modules/autonomy/shared.js", () => ({
  loadRecentRuns: vi.fn().mockReturnValue([]),
  computeCostByWorkflow: vi.fn().mockReturnValue({}),
}));

function makeStatusInfo(overrides: Partial<StatusInfo> = {}): StatusInfo {
  return {
    runtimeState: {
      activeRuns: [],
      completedRuns: 5,
      pendingRuns: [],
      workflows: {
        builder: {
          lastStarted: { runId: "run-abc", startedAt: "2026-01-01T00:00:00Z" },
          lastCompletion: {
            runId: "run-abc",
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:10Z",
            status: "success",
          },
        },
      },
      ...overrides.runtimeState,
    },
    dispatchPaused: false,
    runsDir: "/fake/runs",
    runAuthority: {
      authorityCriticalRunIds: new Set(),
      operationallyActiveRunIds: new Set(),
      terminalRunIds: new Set(),
    },
    ...overrides,
  };
}

describe("buildStatusText", () => {
  it("shows idle dispatch when no active runs", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Dispatch:* idle");
  });

  it("shows active dispatch when activeRuns present", () => {
    const text = buildStatusText(
      makeStatusInfo({
        runtimeState: {
          completedRuns: 1,
          pendingRuns: [],
          workflows: {},
          activeRuns: [{ runId: "run-xyz", workflow: "builder", startedAt: "2026-01-01T00:00:00Z" }],
        },
      }),
    );
    expect(text).toContain("*Dispatch:* active");
    expect(text).toContain("`run-xyz`");
    expect(text).toContain("builder");
  });

  it("shows paused dispatch when dispatchPaused is true", () => {
    const text = buildStatusText(makeStatusInfo({ dispatchPaused: true }));
    expect(text).toContain("*Dispatch:* paused");
  });

  it("includes today's spend", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Today's spend:*");
    expect(text).toContain("$0.0000");
  });

  it("includes last status per workflow", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Last status:*");
    expect(text).toContain("builder: success");
  });

  it("omits last status section when no workflows have status", () => {
    const text = buildStatusText(
      makeStatusInfo({
        runtimeState: { activeRuns: [], completedRuns: 0, pendingRuns: [], workflows: {} },
      }),
    );
    expect(text).not.toContain("*Last status:*");
  });
});

