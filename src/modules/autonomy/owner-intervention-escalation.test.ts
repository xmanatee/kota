import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MS_PER_DAY,
  makeProjectDir,
  NOW,
  ownerInterventionReport,
  writeQuestion,
} from "./owner-intervention-escalation.test-helpers.js";

describe("owner intervention escalation report", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("surfaces active recurring patterns and generated task ids in the operator report", () => {
    writeQuestion(projectDir, {
      id: "correct1",
      status: "answered",
      runId: "run-a",
      resolvedAt: new Date(NOW - 50_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Use the blocked-promoter path instead.",
    });
    writeQuestion(projectDir, {
      id: "correct2",
      status: "answered",
      runId: "run-b",
      resolvedAt: new Date(NOW - 40_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Do not continue; use the blocked-promoter path instead.",
    });

    const data = ownerInterventionReport(projectDir);

    expect(data.recurringPatterns.activePatterns).toHaveLength(1);
    expect(data.recurringPatterns.activePatterns[0]).toMatchObject({
      kind: "repeated-freeform-correction",
      action: "create",
    });
    expect(data.recurringPatterns.activePatterns[0]?.repairTaskId).toMatch(
      /^task-repair-owner-intervention-pattern-/,
    );
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("Private prompt context");
    expect(serialized).not.toContain("blocked-promoter path instead");
    expect(serialized).not.toMatch(/\bcost\b/i);
  });

  it("reports stale record-only health-reviewer recurrence without opening an active repair task", () => {
    writeQuestion(projectDir, {
      id: "health-stale-a",
      status: "pending",
      runId: "health-run-a",
      taskId: null,
      workflowName: "autonomy-health-reviewer",
      source: "autonomy-health-reviewer",
      answerBehavior: "record-only",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });
    writeQuestion(projectDir, {
      id: "health-stale-b",
      status: "pending",
      runId: "health-run-b",
      taskId: null,
      workflowName: "autonomy-health-reviewer",
      source: "autonomy-health-reviewer",
      answerBehavior: "record-only",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });

    const data = ownerInterventionReport(projectDir);

    expect(data.recurringPatterns.activePatterns).toEqual([]);
    expect(data.recurringPatterns.ignoredPatterns).toHaveLength(1);
    expect(data.recurringPatterns.ignoredPatterns[0]).toMatchObject({
      kind: "repeated-stale-or-expired",
      action: "ignored",
      repairTaskId: expect.stringMatching(
        /^task-repair-owner-intervention-pattern-/,
      ),
      questionIds: ["health-stale-a", "health-stale-b"],
      runIds: ["health-run-a", "health-run-b"],
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("Private prompt context");
    expect(serialized).not.toContain("Which path should");
    expect(serialized).not.toMatch(/\bcost\b/i);
  });
});
