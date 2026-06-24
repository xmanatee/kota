import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MS_PER_DAY,
  makeProjectDir,
  NOW,
  ownerInterventionDetection,
  writeQuestion,
} from "./owner-intervention-escalation.test-helpers.js";

describe("owner intervention escalation detection", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("detects repeated stale and expired owner questions", () => {
    writeQuestion(projectDir, {
      id: "stale1",
      status: "pending",
      runId: "run-a",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
      timeoutMs: 60 * 60 * 1000,
    });
    writeQuestion(projectDir, {
      id: "expired1",
      status: "expired",
      runId: "run-b",
      resolvedAt: new Date(NOW - 10_000).toISOString(),
      timeoutMs: 60 * 60 * 1000,
      resolutionSource: "timeout",
    });

    const found = ownerInterventionDetection(projectDir);

    expect(found.patterns).toHaveLength(1);
    expect(found.patterns[0]).toMatchObject({
      kind: "repeated-stale-or-expired",
      questionIds: ["expired1", "stale1"],
      statuses: ["expired", "pending"],
    });
  });

  it("detects workflow and source recurrence across different task ids", () => {
    writeQuestion(projectDir, {
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
    writeQuestion(projectDir, {
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
    writeQuestion(projectDir, {
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
    writeQuestion(projectDir, {
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

    const found = ownerInterventionDetection(projectDir);

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
    writeQuestion(projectDir, {
      id: "provider1",
      status: "answered",
      runId: "run-provider-a",
      answer: "This is provider API outage noise; ignore the false alarm.",
    });
    writeQuestion(projectDir, {
      id: "provider2",
      status: "answered",
      runId: "run-provider-b",
      answer: "Network provider timeout noise, dismiss as transient.",
    });
    writeQuestion(projectDir, {
      id: "setup1",
      status: "answered",
      runId: "run-setup-a",
      answer: "Configure the missing API key credential before retrying.",
    });
    writeQuestion(projectDir, {
      id: "setup2",
      status: "answered",
      runId: "run-setup-b",
      answer: "Install Playwright storage state and log in before retrying.",
    });
    writeQuestion(projectDir, {
      id: "legacy1",
      status: "answered",
      answer: "Use the safer path instead.",
      omitOrigin: true,
      omitAnswerBehavior: true,
    });
    writeQuestion(projectDir, {
      id: "legacy2",
      status: "answered",
      answer: "Do not continue; use the safer path.",
      omitOrigin: true,
      omitAnswerBehavior: true,
    });

    const found = ownerInterventionDetection(projectDir);

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
