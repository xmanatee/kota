import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { applyProgressReviewActions } from "./actions.js";

describe("progress-reviewer generated-work resolution", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("drops stale steering work when canonical recovery evidence disproves it", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-progress-resolution-"));
    projectDirs.push(projectDir);
    for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
      mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    }
    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    const proposalKey = "progress-reviewer:recovery:stale-worktrees";
    const created = materializeGeneratedWorkProposal({
      projectDir,
      proposal: {
        kind: "task",
        proposalKey,
        title: "Recover stale builder worktrees",
        summary: "Two stale builder worktrees appear to block ready work.",
        priority: "p1",
        area: "autonomy",
        taskClass: "Meta",
        body: [
          "## Problem",
          "",
          "The progress review projected stale worktrees.",
          "",
          "## Product / Safety Link",
          "",
          "Recovery protects Product and Safety delivery.",
        ].join("\n"),
        provenance: {
          source: "progress-reviewer",
          runId: "progress-review-before",
          evidenceRefs: ["state:recovery"],
        },
      },
    });

    const result = applyProgressReviewActions({
      projectDir,
      scopeDir: projectDir,
      runId: "progress-review-after",
      evidence: {
        evidence: [{
          id: "state:recovery",
          kind: "state",
          summary: "Canonical recovery projection worktrees=1 staleWorktrees=0",
          path: ".kota/worktrees/",
        }],
      },
      review: {
        verdict: "on-track",
        summary: "Canonical recovery state disproves the stale-worktree premise.",
        findings: {
          crossScope: { claims: [], followUpTasks: [] },
          localScope: { claims: [], followUpTasks: [] },
        },
        ownerQuestions: [],
        resolutions: [{
          topicKey: "recovery:stale-worktrees",
          reason: "The canonical projection reports no stale worktrees.",
          evidenceIds: ["state:recovery"],
        }],
      },
    });

    expect(result).toMatchObject({
      touchedTaskQueue: true,
      applied: expect.arrayContaining([
        { kind: "dropped-task", taskId: created.taskId, fromState: "ready" },
        {
          kind: "owner-question-dismissal-pending",
          topicKey: "recovery:stale-worktrees",
          reason: "The canonical projection reports no stale worktrees.",
        },
      ]),
    });
    expect(listFullRepoTasks(projectDir)).toEqual([
      expect.objectContaining({ id: created.taskId, state: "dropped" }),
    ]);
  });
});
