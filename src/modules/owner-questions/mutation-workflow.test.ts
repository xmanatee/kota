import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveModuleWorkflows } from "#core/modules/module-definition.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import ownerQuestionsModule from "./index.js";

describe("owner-question mutation workflow", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("durably owns requested dismissals after the requesting run commits", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-owner-question-writer-"));
    roots.push(projectDir);
    const queue = new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
    );
    const question = queue.enqueue({
      context: "Fixture context",
      question: "Is this issue still open?",
      reason: "Fixture reason",
      source: "fixture",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
    });
    const workflows = await resolveModuleWorkflows(
      ownerQuestionsModule,
      {} as never,
    );
    const writer = workflows.find(
      (workflow) => workflow.name === "owner-question-mutation",
    );

    expect(writer).toBeDefined();
    if (!writer) return;

    const result = await new WorkflowTestHarness(writer, {
      projectDir,
      trigger: {
        event: "owner.question.mutation.requested",
        payload: {
          questionId: question.id,
          mutation: "dismiss",
          reason: "The linked issue cleared",
          resolutionSource: "autonomy-health-reviewer",
          idempotencyKey: `owner-question:${question.id}:dismiss`,
        },
      },
    }).run();

    expect(result.status).toBe("success");
    expect(queue.get(question.id)).toMatchObject({
      status: "dismissed",
      dismissalReason: "The linked issue cleared",
      resolutionSource: "autonomy-health-reviewer",
    });
    expect(result.emitted.map((event) => event.event)).toEqual([
      "owner.question.resolved",
      "owner.question.dismissed",
      "owner.question.changed",
    ]);
  });
});
