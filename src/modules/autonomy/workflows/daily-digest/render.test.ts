import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DailyDigestData } from "./aggregate.js";
import { renderDailyDigest } from "./render.js";

const FIXTURES_DIR = join(
  import.meta.dirname,
  "__fixtures__",
);

function loadFixture(name: string): DailyDigestData {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf-8"),
  );
}

function loadFixtureRendered(name: string): string {
  return readFileSync(join(FIXTURES_DIR, `${name}.txt`), "utf-8");
}

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
    current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
    previous: null,
    delta: { backlog: null, ready: null, doing: null, blocked: null },
  },
  quiet: true,
};

describe("renderDailyDigest", () => {
  it("renders quiet window with no-activity message", () => {
    const text = renderDailyDigest(emptyDigest);
    expect(text).toContain("Daily digest");
    expect(text).toContain("No autonomy activity in this window.");
    expect(text).toContain("Queue state");
    expect(text).toContain("ready: 0");
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
          toReady: ["task-x"],
          toBacklog: ["task-y"],
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
        current: { backlog: 5, ready: 2, doing: 1, blocked: 3 },
        previous: { backlog: 7, ready: 0, doing: 1, blocked: 4 },
        delta: { backlog: -2, ready: 2, doing: 0, blocked: -1 },
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
    expect(text).toContain("blocked → ready");
    expect(text).toContain("blocked → backlog");
    expect(text).toContain("Failed/interrupted monitored runs (1)");
    expect(text).toContain("see attention-digest");
    expect(text).toContain("Pending owner questions (1)");
    expect(text).toContain("Approve variant A?");
    expect(text).toContain("Aging operator-capture preconditions (1)");
    expect(text).toContain("task-needs-shot");
    expect(text).toContain("Queue state");
    expect(text).toContain("backlog: 5");
    expect(text).toContain("(-2)");
    expect(text).toContain("ready: 2");
    expect(text).toContain("(+2)");
    expect(text).toContain("doing: 1");
    expect(text).toContain("(=)");
  });

  it("is deterministic for the same input", () => {
    const a = renderDailyDigest(emptyDigest);
    const b = renderDailyDigest(emptyDigest);
    expect(a).toBe(b);
  });

  it("contains no ANSI escape sequences (chat-channel safe)", () => {
    const text = renderDailyDigest(loadFixture("sample-active"));
    // ESC sequences would render as garbage on Telegram/Slack/email.
    const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[`);
    expect(text).not.toMatch(ansiPattern);
  });

  it("matches the committed sample-active fixture", () => {
    const text = renderDailyDigest(loadFixture("sample-active"));
    expect(`${text}\n`).toBe(loadFixtureRendered("sample-active"));
  });

  it("matches the committed sample-quiet fixture", () => {
    const text = renderDailyDigest(loadFixture("sample-quiet"));
    expect(`${text}\n`).toBe(loadFixtureRendered("sample-quiet"));
  });
});
