import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { applyBacklogPromotionOperation } from "#modules/autonomy/workflows/backlog-promoter/blocking-operations.js";
import { applyDecompositionOperation } from "#modules/autonomy/workflows/decomposer/blocking-operations.js";
import { discoverRepoAiChecksOperation } from "#modules/autonomy/workflows/repo-ai-checks/blocking-operations.js";

const TASK_STATES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "dropped",
] as const;

function taskMarkdown(id: string, status: string, title: string): string {
  return `---
id: ${id}
title: ${title}
status: ${status}
priority: p1
area: core
task_class: Platform
summary: Exercise a production repository operation through a worker.
created_at: 2026-08-14T12:00:00.000Z
updated_at: 2026-08-14T12:00:00.000Z
---

## Problem

Repository work must not block daemon control requests.

## Desired Outcome

The production mutation completes in a workflow worker.

## Constraints

- Preserve canonical task mutation semantics.

## Done When

- The worker applies the requested repository change.

## Source / Intent

Exercise the daemon responsiveness boundary with a real operation.

## Initiative

Responsive daemon control.

## Acceptance Evidence

- Focused real-worker integration output.
`;
}

function makeProject(prefix: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), prefix));
  for (const state of TASK_STATES) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "kota@example.test"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "KOTA Test"], {
    cwd: projectDir,
  });
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  return projectDir;
}

function commitFixture(projectDir: string): void {
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], {
    cwd: projectDir,
  });
}

describe("queue and discovery blocking operations", () => {
  it("runs production queue mutation, decomposition, and recursive discovery in real workers", async () => {
    const backlogProject = makeProject("kota-backlog-worker-");
    const decomposerProject = makeProject("kota-decomposer-worker-");
    const discoveryProject = makeProject("kota-repo-ai-worker-");
    try {
      writeFileSync(
        join(backlogProject, "data/tasks/backlog/task-worker-promotion.md"),
        taskMarkdown("task-worker-promotion", "backlog", "Worker promotion"),
      );
      commitFixture(backlogProject);

      writeFileSync(
        join(decomposerProject, "data/tasks/doing/task-worker-decomposition.md"),
        taskMarkdown(
          "task-worker-decomposition",
          "doing",
          "Worker decomposition",
        ),
      );
      commitFixture(decomposerProject);

      const checksDir = join(discoveryProject, ".agents", "checks");
      mkdirSync(checksDir, { recursive: true });
      writeFileSync(
        join(checksDir, "responsiveness.md"),
        "---\nname: Responsiveness\ndescription: Check daemon responsiveness\n---\n\nKeep control requests responsive.\n",
      );
      commitFixture(discoveryProject);

      const artifactDir = ".kota/runs/worker-boundary/repo-ai-checks";
      let timerFired = false;
      const timer = setTimeout(() => {
        timerFired = true;
      }, 0);
      const [promotion, decomposition, discovery] = await Promise.all([
        runWorkflowBlockingOperation(applyBacklogPromotionOperation, {
          projectDir: backlogProject,
          taskIds: ["task-worker-promotion"],
        }),
        runWorkflowBlockingOperation(applyDecompositionOperation, {
          projectDir: decomposerProject,
          taskId: "task-worker-decomposition",
          failedRunId: "failed-builder-worker-boundary",
          plan: {
            rationale: "Create one independently verifiable worker-boundary slice.",
            subtasks: [
              {
                title: "Worker decomposition slice",
                summary: "Complete the decomposed repository operation safely.",
                priority: "p1",
                area: "core",
                taskClass: "Platform",
                problem: "The original work requires a smaller execution unit.",
                desiredOutcome: "The bounded slice is independently verifiable.",
                constraints: ["Preserve the original task intent."],
                doneWhen: ["Focused evidence proves the bounded result."],
                sourceIntent: "Recover an exhausted builder task without blocking control.",
                initiative: "Responsive daemon control.",
                acceptanceEvidence: ["Focused worker integration output."],
                dependsOn: [],
              },
            ],
          },
        }),
        runWorkflowBlockingOperation(discoverRepoAiChecksOperation, {
          projectDir: discoveryProject,
          artifactDir,
          artifactDirPath: join(discoveryProject, artifactDir),
          assessment: {
            skip: false,
            repo: "owner/repo",
            prNumber: 42,
            title: "Keep control responsive",
            headBranch: "feature/responsive-control",
            baseBranch: "main",
            headSha: "abc123",
          },
        }),
      ]);
      clearTimeout(timer);

      expect(timerFired).toBe(true);
      expect(promotion.promotions).toEqual([
        expect.objectContaining({
          id: "task-worker-promotion",
          fromState: "backlog",
          toState: "ready",
        }),
      ]);
      expect(
        existsSync(
          join(backlogProject, "data/tasks/ready/task-worker-promotion.md"),
        ),
      ).toBe(true);
      expect(decomposition).toEqual({
        taskId: "task-worker-decomposition",
        subtaskIds: ["task-worker-decomposition-slice"],
      });
      expect(
        existsSync(
          join(
            decomposerProject,
            "data/tasks/dropped/task-worker-decomposition.md",
          ),
        ),
      ).toBe(true);
      expect(discovery).toMatchObject({
        skip: false,
        checks: [
          expect.objectContaining({
            name: "Responsiveness",
          }),
        ],
      });
      expect(
        existsSync(join(discoveryProject, artifactDir, "discovery.json")),
      ).toBe(true);
    } finally {
      rmSync(backlogProject, { recursive: true, force: true });
      rmSync(decomposerProject, { recursive: true, force: true });
      rmSync(discoveryProject, { recursive: true, force: true });
    }
  });
});
