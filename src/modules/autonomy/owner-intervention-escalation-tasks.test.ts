import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  applyOwnerInterventionEscalation,
  proposeOwnerInterventionEscalation,
} from "./owner-intervention-escalation.js";
import {
  makeProjectDir,
  NOW,
  ownerInterventionDetection,
  writeQuestion,
} from "./owner-intervention-escalation.test-helpers.js";

describe("owner intervention escalation task proposals", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates one sanitized ready repair task for repeated free-form corrections", () => {
    writeQuestion(projectDir, {
      id: "correct1",
      status: "answered",
      runId: "run-a",
      resolvedAt: new Date(NOW - 50_000).toISOString(),
      proposedAnswers: ["Keep current behavior"],
      answer: "No, use the blocked-promoter path instead: sk_live_12345.",
    });
    writeQuestion(projectDir, {
      id: "correct2",
      status: "answered",
      runId: "run-b",
      resolvedAt: new Date(NOW - 40_000).toISOString(),
      proposedAnswers: ["Keep current behavior"],
      answer: "Do not keep asking; switch to the fallback instead.",
    });

    const found = ownerInterventionDetection(projectDir);
    expect(found.patterns).toHaveLength(1);
    expect(found.patterns[0]).toMatchObject({
      kind: "repeated-freeform-correction",
      questionCount: 2,
      distinctRunCount: 2,
      taskIds: ["task-owner-pattern"],
    });

    const pattern = found.patterns[0]!;
    const applied = applyOwnerInterventionEscalation(
      proposeOwnerInterventionEscalation(projectDir, pattern),
      { projectDir, nowIso: new Date(NOW).toISOString() },
    );
    expect(applied.kind).toBe("created");
    const task = readFileSync(
      join(projectDir, "data", "tasks", "ready", `${pattern.taskId}.md`),
      "utf-8",
    );
    expect(task).toContain("status: ready");
    expect(task).toContain("task_class: Safety");
    expect(task).toContain("correct1");
    expect(task).toContain("run-a");
    expect(task).not.toContain("Private prompt context");
    expect(task).not.toContain("Which path should");
    expect(task).not.toContain("sk_live_12345");
    expect(task).not.toMatch(/\bcost\b/i);
    expect(assertTaskQueueValid(projectDir).errorCount).toBe(0);
  });

  it("suppresses duplicate evidence, refreshes changed open evidence, and recreates returned done patterns", () => {
    writeQuestion(projectDir, {
      id: "correct1",
      status: "answered",
      runId: "run-a",
      resolvedAt: new Date(NOW - 50_000).toISOString(),
      answer: "Use the safer path instead.",
      proposedAnswers: ["Continue"],
    });
    writeQuestion(projectDir, {
      id: "correct2",
      status: "answered",
      runId: "run-b",
      resolvedAt: new Date(NOW - 40_000).toISOString(),
      answer: "Do not continue; switch to the safer path.",
      proposedAnswers: ["Continue"],
    });
    const first = ownerInterventionDetection(projectDir).patterns[0]!;
    applyOwnerInterventionEscalation(
      proposeOwnerInterventionEscalation(projectDir, first),
      { projectDir, nowIso: new Date(NOW).toISOString() },
    );

    expect(proposeOwnerInterventionEscalation(projectDir, first)).toMatchObject({
      action: "noop",
      existingState: "ready",
    });

    writeQuestion(projectDir, {
      id: "correct3",
      status: "answered",
      runId: "run-c",
      resolvedAt: new Date(NOW - 30_000).toISOString(),
      answer: "Rather than continue, use the safer path.",
      proposedAnswers: ["Continue"],
    });
    const changed = ownerInterventionDetection(projectDir).patterns[0]!;
    expect(proposeOwnerInterventionEscalation(projectDir, changed).action).toBe(
      "refresh",
    );
    applyOwnerInterventionEscalation(
      proposeOwnerInterventionEscalation(projectDir, changed),
      { projectDir, nowIso: new Date(NOW + 1000).toISOString() },
    );
    moveTaskById(projectDir, changed.taskId, "done");

    writeQuestion(projectDir, {
      id: "correct4",
      status: "answered",
      runId: "run-d",
      resolvedAt: new Date(NOW - 20_000).toISOString(),
      answer: "Stop continuing and use the safer path.",
      proposedAnswers: ["Continue"],
    });
    const returned = ownerInterventionDetection(projectDir).patterns[0]!;
    expect(proposeOwnerInterventionEscalation(projectDir, returned)).toMatchObject({
      action: "recreate",
      previousState: "done",
    });
  });
});
