import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MS_PER_DAY,
  makeScopeRoot,
  NOW,
  ownerInterventionDetection,
  writeQuestion,
} from "./owner-intervention-escalation.test-helpers.js";

describe("owner intervention escalation detection", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("detects repeated stale and expired owner questions", () => {
    writeQuestion(workspaceRoot, {
      id: "stale1",
      status: "pending",
      runId: "run-a",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
      timeoutMs: 60 * 60 * 1000,
    });
    writeQuestion(workspaceRoot, {
      id: "expired1",
      status: "expired",
      runId: "run-b",
      resolvedAt: new Date(NOW - 10_000).toISOString(),
      timeoutMs: 60 * 60 * 1000,
      resolutionSource: "timeout",
    });

    const found = ownerInterventionDetection(workspaceRoot);

    expect(found.patterns).toHaveLength(1);
    expect(found.patterns[0]).toMatchObject({
      kind: "repeated-stale-or-expired",
      questionIds: ["expired1", "stale1"],
      statuses: ["expired", "pending"],
    });
  });

  it("keeps stale record-only health reviewer questions reportable but out of active repair escalation", () => {
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

    const found = ownerInterventionDetection(workspaceRoot);

    expect(found.patterns).toEqual([]);
    expect(found.ignoredPatterns).toHaveLength(1);
    expect(found.ignoredPatterns[0]).toMatchObject({
      kind: "repeated-stale-or-expired",
      actionability: "ignored",
      dimension: { kind: "workflow", value: "autonomy-health-reviewer" },
      questionIds: ["health-stale-a", "health-stale-b"],
      runIds: ["health-run-a", "health-run-b"],
      taskIds: [],
      ignoredReason:
        "record-only owner questions preserve operator follow-up evidence without blocking workflow progress.",
    });
  });

  it("detects workflow and source recurrence across different task ids", () => {
    writeQuestion(workspaceRoot, {
      id: "workflow-task-a",
      status: "answered",
      runId: "run-workflow-a",
      taskId: "task-workflow-a",
      workflowName: "builder",
      source: "workflow-question",
      resolvedAt: new Date(NOW - 50_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Use the available-queue path instead.",
    });
    writeQuestion(workspaceRoot, {
      id: "workflow-task-b",
      status: "answered",
      runId: "run-workflow-b",
      taskId: "task-workflow-b",
      workflowName: "builder",
      source: "workflow-question",
      resolvedAt: new Date(NOW - 40_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Do not continue; switch to the available-queue path.",
    });
    writeQuestion(workspaceRoot, {
      id: "source-task-a",
      status: "answered",
      runId: "run-source-a",
      taskId: "task-source-a",
      workflowName: "dispatcher",
      source: "shared-owner-source",
      resolvedAt: new Date(NOW - 30_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Rather than continue, use the explicit dispatch path.",
    });
    writeQuestion(workspaceRoot, {
      id: "source-task-b",
      status: "answered",
      runId: "run-source-b",
      taskId: "task-source-b",
      workflowName: "improver",
      source: "shared-owner-source",
      resolvedAt: new Date(NOW - 20_000).toISOString(),
      proposedAnswers: ["Continue"],
      answer: "Stop continuing and use the explicit dispatch path.",
    });

    const found = ownerInterventionDetection(workspaceRoot);

    expect(found.patterns.map((pattern) => pattern.dimension)).toEqual([
      { kind: "source", value: "shared-owner-source" },
      { kind: "workflow", value: "builder" },
    ]);
    expect(found.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: { kind: "workflow", value: "builder" },
          questionIds: ["workflow-task-a", "workflow-task-b"],
          taskIds: ["task-workflow-a", "task-workflow-b"],
        }),
        expect.objectContaining({
          dimension: { kind: "source", value: "shared-owner-source" },
          questionIds: ["source-task-a", "source-task-b"],
          workflowNames: ["dispatcher", "improver"],
        }),
      ]),
    );
  });

  it("keeps provider/setup-only and legacy records out of the active escalation gate", () => {
    writeQuestion(workspaceRoot, {
      id: "provider1",
      status: "answered",
      runId: "run-provider-a",
      answer: "This is provider API outage noise; ignore the false alarm.",
    });
    writeQuestion(workspaceRoot, {
      id: "provider2",
      status: "answered",
      runId: "run-provider-b",
      answer: "Network provider timeout noise, dismiss as transient.",
    });
    writeQuestion(workspaceRoot, {
      id: "setup1",
      status: "answered",
      runId: "run-setup-a",
      answer: "Configure the missing API key credential before retrying.",
    });
    writeQuestion(workspaceRoot, {
      id: "setup2",
      status: "answered",
      runId: "run-setup-b",
      answer: "Install Playwright storage state and log in before retrying.",
    });
    writeQuestion(workspaceRoot, {
      id: "legacy1",
      status: "answered",
      answer: "Use the safer path instead.",
      omitOrigin: true,
      omitAnswerBehavior: true,
    });
    writeQuestion(workspaceRoot, {
      id: "legacy2",
      status: "answered",
      answer: "Do not continue; use the safer path.",
      omitOrigin: true,
      omitAnswerBehavior: true,
    });

    const found = ownerInterventionDetection(workspaceRoot);

    expect(found.patterns).toEqual([]);
    expect(
      found.ignoredPatterns.find((pattern) =>
        pattern.ignoredReason?.startsWith("owner answers classify"),
      ),
    ).toMatchObject({
      outcomeBuckets: ["provider-noise-dismissal", "setup-action"],
      questionIds: ["provider1", "provider2", "setup1", "setup2"],
    });
    expect(found.ignoredPatterns.map((pattern) => pattern.ignoredReason).sort()).toEqual(
      [
        "legacy/unknown owner-question records lack enough metadata for auto-escalation.",
        "owner answers classify as provider/setup-only pressure; keep this as report evidence.",
      ].sort(),
    );
  });
});
