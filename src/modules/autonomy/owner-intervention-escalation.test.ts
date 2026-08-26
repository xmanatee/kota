import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MS_PER_DAY,
  makeScopeRoot,
  NOW,
  ownerInterventionReport,
  writeQuestion,
} from "./owner-intervention-escalation.test-helpers.js";

describe("owner intervention escalation report", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("surfaces active recurring corrections as observation-only patterns", () => {
    writeQuestion(workspaceRoot, {
      id: "correct1",
      status: "answered",
      runId: "run-a",
      resolvedAt: new Date(NOW - 50_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Use the blocked-promoter path instead.",
    });
    writeQuestion(workspaceRoot, {
      id: "correct2",
      status: "answered",
      runId: "run-b",
      resolvedAt: new Date(NOW - 40_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Do not continue; use the blocked-promoter path instead.",
    });

    const data = ownerInterventionReport(workspaceRoot);

    expect(data.recurringPatterns.activePatterns).toHaveLength(1);
    expect(data.recurringPatterns.activePatterns[0]).toMatchObject({
      kind: "repeated-freeform-correction",
      questionIds: ["correct1", "correct2"],
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("repairTaskId");
    expect(serialized).not.toContain('"action"');
    expect(serialized).not.toContain("Private prompt context");
    expect(serialized).not.toContain("blocked-promoter path instead");
    expect(serialized).not.toMatch(/\bcost\b/i);
  });

  it("reports ignored stale record-only health-reviewer recurrence", () => {
    writeQuestion(workspaceRoot, {
      id: "health-stale-a",
      status: "pending",
      runId: "health-run-a",
      taskId: null,
      workflowName: "autonomy-health-reviewer",
      source: "autonomy-health-reviewer",
      answerBehavior: "record-only",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });
    writeQuestion(workspaceRoot, {
      id: "health-stale-b",
      status: "pending",
      runId: "health-run-b",
      taskId: null,
      workflowName: "autonomy-health-reviewer",
      source: "autonomy-health-reviewer",
      answerBehavior: "record-only",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });

    const data = ownerInterventionReport(workspaceRoot);

    expect(data.recurringPatterns.activePatterns).toEqual([]);
    expect(data.recurringPatterns.ignoredPatterns).toHaveLength(1);
    expect(data.recurringPatterns.ignoredPatterns[0]).toMatchObject({
      kind: "repeated-stale-or-expired",
      questionIds: ["health-stale-a", "health-stale-b"],
      runIds: ["health-run-a", "health-run-b"],
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("Private prompt context");
    expect(serialized).not.toContain("Which path should");
    expect(serialized).not.toMatch(/\bcost\b/i);
  });
});
