import { describe, expect, it } from "vitest";
import type { DailyDigestData } from "./aggregate.js";
import { renderDailyDigest } from "./render.js";

const baseWindow = {
  windowStartedAt: "2026-04-25T08:00:00.000Z",
  windowEndedAt: "2026-04-26T08:00:00.000Z",
};

const emptyDigest: DailyDigestData = {
  ...baseWindow,
  builderCommits: [],
  explorerAdditions: [],
  decomposerSplits: [],
  blockedPromoterMoves: [],
  failedMonitoredRuns: [],
  pendingOwnerQuestions: [],
  agingOperatorCaptures: [],
  queueDelta: {
    current: { open: 0, blocked: 0 },
    previous: null,
    delta: { open: null, blocked: null },
  },
  quiet: true,
};

describe("renderDailyDigest", () => {
  it("renders quiet window with no-activity message", () => {
    const text = renderDailyDigest(emptyDigest);
    expect(text).toContain("Daily digest");
    expect(text).toContain("No autonomy activity in this window.");
    expect(text).toContain("Queue state");
    expect(text).toContain("open: 0");
    expect(text).toContain("(no prior snapshot)");
  });

  it("renders active window with all seven categories", () => {
    const data: DailyDigestData = {
      ...baseWindow,
      builderCommits: [
        {
          runId: "run-builder-a",
          taskId: "task-foo",
          taskTitle: "Foo",
          commitSubject: "Add foo",
          durationMs: 60_000,
        },
      ],
      explorerAdditions: [
        { runId: "run-explorer-a", taskCount: 2, watchlistAdds: 1 },
      ],
      decomposerSplits: [
        {
          runId: "run-decomp-a",
          parentTaskId: "task-big",
          childTaskCount: 3,
        },
      ],
      blockedPromoterMoves: [
        {
          runId: "run-promo-a",
          promotedTaskIds: ["task-x", "task-y"],
          toOpen: ["task-x", "task-y"],
        },
      ],
      failedMonitoredRuns: [
        {
          runId: "run-improver-a",
          workflow: "improver",
          status: "failed",
          startedAt: "2026-04-25T10:00:00.000Z",
        },
      ],
      pendingOwnerQuestions: [
        {
          id: "q1",
          source: "blocked-promoter",
          ageDays: 3,
          question: "Approve variant A?",
        },
      ],
      agingOperatorCaptures: [
        {
          taskId: "task-needs-shot",
          ageDays: 21,
          path: ".kota/captures/x.png",
        },
      ],
      queueDelta: {
        current: { open: 8, blocked: 3 },
        previous: { open: 8, blocked: 4 },
        delta: { open: 0, blocked: -1 },
      },
      quiet: false,
    };
    const text = renderDailyDigest(data);
    expect(text).toContain("Builder commits (1, 1m total)");
    expect(text).toContain("task-foo");
    expect(text).toContain("Add foo");
    expect(text).toContain("Explorer additions");
    expect(text).toContain("Decomposer splits (1)");
    expect(text).toContain("task-big → 3 child tasks");
    expect(text).toContain("Blocked-promoter moves (2 tasks promoted across 1 run)");
    expect(text).toContain("blocked → open");
    expect(text).toContain("Failed/interrupted monitored runs (1)");
    expect(text).toContain("see attention-digest");
    expect(text).toContain("Pending owner questions (1)");
    expect(text).toContain("Approve variant A?");
    expect(text).toContain("Aging operator-capture preconditions (1)");
    expect(text).toContain("task-needs-shot");
    expect(text).toContain("Queue state");
    expect(text).toContain("open: 8");
    expect(text).toContain("(=)");
    // Shared notification text must remain safe to display without a terminal.
    expect(text).not.toContain(String.fromCharCode(27));
  });

});
