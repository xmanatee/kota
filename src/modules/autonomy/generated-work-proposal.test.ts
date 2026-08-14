import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  generatedWorkTaskMutationPaths,
  materializeGeneratedWorkProposal,
} from "./generated-work-proposal.js";
import {
  cleanupGeneratedWorkProjectDirs,
  GENERATED_WORK_TASK_STATES,
  makeGeneratedWorkProjectDir,
  placeTaskInState,
  questionProposal,
  taskProposal,
} from "./generated-work-proposal.test-helpers.js";

afterEach(cleanupGeneratedWorkProjectDirs);

describe("generated-work proposal materializer", () => {
  for (const state of GENERATED_WORK_TASK_STATES) {
    it(`finds and revises the same task from ${state}`, () => {
      const projectDir = makeGeneratedWorkProjectDir(state);
      const created = materializeGeneratedWorkProposal({
        projectDir,
        proposal: taskProposal(),
      });
      const taskId = created.taskId!;
      placeTaskInState(projectDir, taskId, state);

      const revised = materializeGeneratedWorkProposal({
        projectDir,
        proposal: taskProposal({
          summary: "Revised issue disposition with stronger evidence.",
          provenance: {
            source: "improver",
            runId: "review-run-2",
            issueKey: "autonomy-issue-fixture",
            semanticRevision: 2,
            evidenceRefs: [".kota/runs/failure-2/metadata.json"],
          },
        }),
      });

      expect(revised.taskId).toBe(taskId);
      const tasks = listFullRepoTasks(projectDir);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.state).toBe(state === "doing" ? "doing" : "ready");
      expect(tasks[0]?.body).toContain("review-run-1");
      expect(tasks[0]?.body).toContain("review-run-2");
      expect(tasks[0]?.body).toContain("failure-2/metadata.json");
    });
  }

  it("revises and reopens one owner-question record across terminal states", () => {
    const projectDir = makeGeneratedWorkProjectDir("question");
    const first = materializeGeneratedWorkProposal({
      projectDir,
      proposal: questionProposal(),
    });
    const questionId = first.ownerQuestionId!;
    const queue = new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
    );
    queue.answer(questionId, "Repair the protocol", "fixture");

    const revised = materializeGeneratedWorkProposal({
      projectDir,
      proposal: questionProposal({
        question: "Should builder repair the protocol now?",
        provenance: {
          source: "improver",
          runId: "review-run-2",
          issueKey: "autonomy-issue-fixture",
          semanticRevision: 2,
          evidenceRefs: [".kota/runs/failure-2/metadata.json"],
        },
      }),
    });

    expect(revised.ownerQuestionId).toBe(questionId);
    expect(revised.actions).toEqual([
      expect.objectContaining({
        kind: "reopened-owner-question",
        questionId,
      }),
    ]);
    expect(queue.list()).toHaveLength(1);
    expect(queue.get(questionId)).toMatchObject({
      status: "pending",
      question: "Should builder repair the protocol now?",
    });
  });

  it("reconciles task, question, and resolved dispositions under one key", () => {
    const projectDir = makeGeneratedWorkProjectDir("lifecycle");
    materializeGeneratedWorkProposal({
      projectDir,
      proposal: questionProposal(),
    });
    const task = materializeGeneratedWorkProposal({
      projectDir,
      proposal: taskProposal(),
    });

    expect(task.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dismissed-owner-question" }),
        expect.objectContaining({ kind: "created-task" }),
      ]),
    );
    expect(task.ownerQuestionId).toBeNull();
    expect(listFullRepoTasks(projectDir)).toHaveLength(1);

    const resolved = materializeGeneratedWorkProposal({
      projectDir,
      proposal: {
        kind: "none",
        proposalKey: "autonomy-issue:stable-fixture",
        reason: "The evidence disproved the issue.",
        source: "improver",
      },
    });

    expect(resolved.actions).toEqual([
      expect.objectContaining({ kind: "dropped-task", taskId: task.taskId }),
    ]);
    expect(resolved.taskId).toBeNull();
    expect(resolved.ownerQuestionId).toBeNull();
    expect(generatedWorkTaskMutationPaths(resolved.actions)).toEqual([
      `data/tasks/dropped/${task.taskId}.md`,
      `data/tasks/ready/${task.taskId}.md`,
    ]);
    expect(listFullRepoTasks(projectDir)[0]?.state).toBe("dropped");
    expect(
      new OwnerQuestionQueue(
        join(projectDir, ".kota", "owner-questions"),
      ).list("pending"),
    ).toEqual([]);
  });

  it("reports only the current linked record when disposition kind changes", () => {
    const projectDir = makeGeneratedWorkProjectDir("current-link");
    const task = materializeGeneratedWorkProposal({
      projectDir,
      proposal: taskProposal(),
    });
    const question = materializeGeneratedWorkProposal({
      projectDir,
      proposal: questionProposal(),
    });

    expect(question).toMatchObject({
      taskId: null,
      ownerQuestionId: expect.stringMatching(/^[0-9a-f]{8}$/),
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: "dropped-task", taskId: task.taskId }),
      ]),
    });
    expect(listFullRepoTasks(projectDir)).toEqual([
      expect.objectContaining({ id: task.taskId, state: "dropped" }),
    ]);
  });
});
