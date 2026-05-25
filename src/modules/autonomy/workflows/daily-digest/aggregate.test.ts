import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type OwnerQuestionEnqueueInput,
  OwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import { aggregateDailyDigest } from "./aggregate.js";

function writeRunMetadata(
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

function writeBuilderRunSummary(
  runsDir: string,
  id: string,
  summary: Record<string, unknown>,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "run-summary.json"),
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
      completedAt: new Date().toISOString(),
      ...summary,
    }),
  );
}

function writeBlockedTask(
  projectDir: string,
  id: string,
  body: string,
  daysAgo = 20,
): void {
  const dir = join(projectDir, "data", "tasks", "blocked");
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const content = `---\nid: ${id}\ntitle: ${id}\nstatus: blocked\npriority: p2\narea: autonomy\nsummary: t\ncreated_at: ${updatedAt}\nupdated_at: ${updatedAt}\n---\n\n## Problem\n\nTest.\n\n${body}`;
  writeFileSync(join(dir, `${id}.md`), content, "utf-8");
}

const NOW = Date.parse("2026-04-26T08:00:00.000Z");

describe("aggregateDailyDigest", () => {
  let projectDir: string;
  let runsDir: string;
  let ownerQuestions: OwnerQuestionQueue;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `daily-digest-aggregate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    ownerQuestions = new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function aggregate(opts?: { previous?: { backlog: number; ready: number; doing: number; blocked: number } }) {
    return aggregateDailyDigest({
      runsDir,
      projectDir,
      ownerQuestions,
      windowEndMs: NOW,
      previousQueueCounts: opts?.previous ?? null,
      currentQueueCounts: { backlog: 5, ready: 2, doing: 1, blocked: 3 },
    });
  }

  it("reports quiet when no runs and nothing pending", () => {
    const data = aggregate();
    expect(data.quiet).toBe(true);
    expect(data.builderCommits).toEqual([]);
    expect(data.queueDelta.current).toEqual({
      backlog: 5,
      ready: 2,
      doing: 1,
      blocked: 3,
    });
    expect(data.queueDelta.delta).toEqual({
      backlog: null,
      ready: null,
      doing: null,
      blocked: null,
    });
  });

  it("collects builder commits from run-summary.json", () => {
    const id = "2026-04-25-builder-a";
    writeRunMetadata(runsDir, id, {
      workflow: "builder",
      status: "success",
      startedAt: new Date(NOW - 60_000).toISOString(),
      completedAt: new Date(NOW - 30_000).toISOString(),
      durationMs: 30_000,
      steps: [],
    });
    writeBuilderRunSummary(runsDir, id, {
      taskId: "task-foo",
      taskTitle: "Foo",
      commitMessage: "Add foo\n\nBody",
      durationMs: 30_000,
    });
    const data = aggregate();
    expect(data.quiet).toBe(false);
    expect(data.builderCommits).toHaveLength(1);
    expect(data.builderCommits[0]).toMatchObject({
      runId: id,
      taskId: "task-foo",
      commitSubject: "Add foo",
    });
  });

  it("ignores runs older than the window", () => {
    const id = "2026-04-23-builder-old";
    writeRunMetadata(runsDir, id, {
      workflow: "builder",
      status: "success",
      startedAt: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date(NOW - 48 * 60 * 60 * 1000 + 1000).toISOString(),
      durationMs: 1000,
      steps: [],
    });
    writeBuilderRunSummary(runsDir, id, {
      taskId: "task-old",
      taskTitle: "Old",
      commitMessage: "Old",
    });
    const data = aggregate();
    expect(data.builderCommits).toHaveLength(0);
    expect(data.quiet).toBe(true);
  });

  it("collects blocked-promoter moves with toReady / toBacklog split", () => {
    const id = "2026-04-25-promoter-a";
    writeRunMetadata(runsDir, id, {
      workflow: "blocked-promoter",
      status: "success",
      startedAt: new Date(NOW - 60_000).toISOString(),
      completedAt: new Date(NOW - 30_000).toISOString(),
      durationMs: 30_000,
      steps: [
        {
          id: "promote-deterministic",
          type: "code",
          status: "success",
          startedAt: "",
          completedAt: "",
          durationMs: 0,
          output: {
            promotions: [
              { id: "task-a", toState: "ready" },
              { id: "task-b", toState: "backlog" },
            ],
          },
        },
        {
          id: "emit-promoted",
          type: "emit",
          status: "success",
          startedAt: "",
          completedAt: "",
          durationMs: 0,
        },
      ],
    });
    const data = aggregate();
    expect(data.blockedPromoterMoves).toHaveLength(1);
    expect(data.blockedPromoterMoves[0]).toMatchObject({
      runId: id,
      promotedTaskIds: ["task-a", "task-b"],
      toReady: ["task-a"],
      toBacklog: ["task-b"],
    });
  });

  it("collects failed monitored runs", () => {
    const id = "2026-04-25-builder-fail";
    writeRunMetadata(runsDir, id, {
      workflow: "builder",
      status: "failed",
      tags: ["monitored"],
      startedAt: new Date(NOW - 60_000).toISOString(),
      completedAt: new Date(NOW - 30_000).toISOString(),
      durationMs: 30_000,
      steps: [],
    });
    const data = aggregate();
    expect(data.failedMonitoredRuns).toHaveLength(1);
    expect(data.failedMonitoredRuns[0]).toMatchObject({
      runId: id,
      workflow: "builder",
      status: "failed",
    });
  });

  it("does not collect failed runs that are not monitored", () => {
    const id = "2026-04-25-misc-fail";
    writeRunMetadata(runsDir, id, {
      workflow: "misc",
      status: "failed",
      tags: [],
      startedAt: new Date(NOW - 60_000).toISOString(),
      completedAt: new Date(NOW - 30_000).toISOString(),
      durationMs: 30_000,
      steps: [],
    });
    const data = aggregate();
    expect(data.failedMonitoredRuns).toHaveLength(0);
  });

  it("collects pending owner questions sorted by age", () => {
    const olderInput: OwnerQuestionEnqueueInput = {
      context: "ctx",
      question: "older?",
      reason: "r",
      source: "test",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "test" },
    };
    const newerInput: OwnerQuestionEnqueueInput = {
      context: "ctx",
      question: "newer?",
      reason: "r",
      source: "test",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "test" },
    };
    const older = ownerQuestions.enqueue(olderInput);
    const newer = ownerQuestions.enqueue(newerInput);
    // backdate older question by writing the file directly through enqueue+rewrite
    writeFileSync(
      join(projectDir, ".kota", "owner-questions", `${older.id}.json`),
      JSON.stringify({
        ...older,
        createdAt: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    writeFileSync(
      join(projectDir, ".kota", "owner-questions", `${newer.id}.json`),
      JSON.stringify({
        ...newer,
        createdAt: new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const data = aggregate();
    expect(data.pendingOwnerQuestions.map((q) => q.id)).toEqual([
      older.id,
      newer.id,
    ]);
    expect(data.pendingOwnerQuestions[0].ageDays).toBeGreaterThanOrEqual(5);
  });

  it("surfaces aged operator-capture preconditions past 14 days", () => {
    writeBlockedTask(
      projectDir,
      "task-needs-screenshot",
      [
        "## Unblock Precondition",
        "",
        "```",
        "kind: operator-capture",
        "path: .kota/captures/screenshot.png",
        "description: needs operator screenshot",
        "```",
        "",
      ].join("\n"),
      20,
    );
    const data = aggregate();
    expect(data.agingOperatorCaptures).toHaveLength(1);
    expect(data.agingOperatorCaptures[0]).toMatchObject({
      taskId: "task-needs-screenshot",
      path: ".kota/captures/screenshot.png",
    });
  });

  it("does not surface operator-capture preconditions under 14 days", () => {
    writeBlockedTask(
      projectDir,
      "task-recent-capture",
      [
        "## Unblock Precondition",
        "",
        "```",
        "kind: operator-capture",
        "path: .kota/captures/screenshot.png",
        "description: needs operator screenshot",
        "```",
        "",
      ].join("\n"),
      5,
    );
    const data = aggregate();
    expect(data.agingOperatorCaptures).toHaveLength(0);
  });

  it("computes queue delta against previous snapshot", () => {
    const data = aggregate({
      previous: { backlog: 7, ready: 0, doing: 1, blocked: 4 },
    });
    expect(data.queueDelta.delta).toEqual({
      backlog: -2,
      ready: 2,
      doing: 0,
      blocked: -1,
    });
  });
});
