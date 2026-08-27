import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  generatedWorkTaskMutationPaths,
  materializeGeneratedWorkProposal,
} from "./generated-work-proposal.js";
import {
  cleanupGeneratedWorkScopeRoots,
  GENERATED_WORK_TASK_STATES,
  makeGeneratedWorkScopeRoot,
  placeTaskInState,
  questionProposal,
  taskProposal,
} from "./generated-work-proposal.test-helpers.js";

afterEach(cleanupGeneratedWorkScopeRoots);

describe("generated-work proposal materializer", () => {
  for (const state of GENERATED_WORK_TASK_STATES) {
    it(`finds and revises the same task from ${state}`, () => {
      const workspaceRoot = makeGeneratedWorkScopeRoot(state);
      const created = materializeGeneratedWorkProposal({
        workspaceRoot,
        proposal: taskProposal(),
      });
      const taskId = created.taskId!;
      placeTaskInState(workspaceRoot, taskId, state);

      const revised = materializeGeneratedWorkProposal({
        workspaceRoot,
        proposal: taskProposal({
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
      const tasks = listFullRepoTasks(workspaceRoot);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.state).toBe("open");
      expect(tasks[0]?.priority).toBe("p1");
      expect(tasks[0]?.body).toContain("A durable autonomy issue needs implementation work.");
      expect(tasks[0]?.body).not.toContain("review-run-");
    });
  }

  it("revises and reopens one owner-question record across terminal states", () => {
    const workspaceRoot = makeGeneratedWorkScopeRoot("question");
    const first = materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: questionProposal(),
    });
    const questionId = first.ownerQuestionId!;
    const queue = new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    );
    queue.answer(questionId, "Repair the protocol", "fixture");

    const revised = materializeGeneratedWorkProposal({
      workspaceRoot,
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
    const workspaceRoot = makeGeneratedWorkScopeRoot("lifecycle");
    materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: questionProposal(),
    });
    const task = materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: taskProposal(),
    });

    expect(task.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dismissed-owner-question" }),
        expect.objectContaining({ kind: "created-task" }),
      ]),
    );
    expect(task.ownerQuestionId).toBeNull();
    expect(listFullRepoTasks(workspaceRoot)).toHaveLength(1);

    const resolved = materializeGeneratedWorkProposal({
      workspaceRoot,
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
      `data/tasks/archive/${task.taskId}.md`,
      `data/tasks/${task.taskId}.md`,
    ]);
    expect(listFullRepoTasks(workspaceRoot)[0]?.state).toBe("dropped");
    expect(
      new OwnerQuestionQueue(
        join(workspaceRoot, ".kota", "owner-questions"),
      ).list("pending"),
    ).toEqual([]);
  });

  it("reports only the current linked record when disposition kind changes", () => {
    const workspaceRoot = makeGeneratedWorkScopeRoot("current-link");
    const task = materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: taskProposal(),
    });
    const question = materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: questionProposal(),
    });

    expect(question).toMatchObject({
      taskId: null,
      ownerQuestionId: expect.stringMatching(/^[0-9a-f]{8}$/),
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: "dropped-task", taskId: task.taskId }),
      ]),
    });
    expect(listFullRepoTasks(workspaceRoot)).toEqual([
      expect.objectContaining({ id: task.taskId, state: "dropped" }),
    ]);
  });
});
