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
import { listBuilderTaskDispatches } from "#modules/autonomy/workflows/builder/task-contract.js";
import { applyDecompositionOperation } from "#modules/autonomy/workflows/decomposer/blocking-operations.js";
import {
  FAILED_RUN_ID,
  failedBuilderMetadata,
  writeRunMetadata,
} from "#modules/autonomy/workflows/decomposer/workflow-test-support.js";
import { discoverRepoAiChecksOperation } from "#modules/autonomy/workflows/repo-ai-checks/blocking-operations.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";

function taskMarkdown(status: string, title: string): string {
  return `---
status: ${status}
priority: p1
---

# ${title}

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
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "kota@example.test"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA Test"], {
    cwd: workspaceRoot,
  });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  return workspaceRoot;
}

function commitFixture(workspaceRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-q", "-m", "initial"], {
    cwd: workspaceRoot,
  });
}

describe("task and discovery blocking operations", () => {
  it("runs production decomposition and recursive discovery in real workers", async () => {
    const decomposerProject = makeProject("kota-decomposer-worker-");
    const discoveryScope = makeProject("kota-repo-ai-worker-");
    try {
      writeFileSync(
        join(decomposerProject, "data/tasks/task-worker-decomposition.md"),
        taskMarkdown("open", "Worker decomposition"),
      );
      commitFixture(decomposerProject);
      const decompositionTaskId = "task-worker-decomposition";
      const decompositionTask = readVerifiedRepoTaskFile(
        decomposerProject,
        "open",
        decompositionTaskId,
      );
      if (decompositionTask === null) {
        throw new Error("decomposition task fixture is missing");
      }
      const dispatch = listBuilderTaskDispatches(decomposerProject).find(
        (candidate) => candidate.taskId === decompositionTaskId,
      );
      if (dispatch === undefined) {
        throw new Error("decomposition dispatch fixture is missing");
      }
      const failedRunId = FAILED_RUN_ID;
      const failedRunDir = `.kota/runs/${failedRunId}`;
      const stateDir = writeRunMetadata(
        decomposerProject,
        failedRunId,
        failedBuilderMetadata(dispatch, { errorKind: "repair-no-progress" }),
      );

      const checksDir = join(discoveryScope, ".agents", "checks");
      mkdirSync(checksDir, { recursive: true });
      writeFileSync(
        join(checksDir, "responsiveness.md"),
        "---\nname: Responsiveness\ndescription: Check daemon responsiveness\n---\n\nKeep control requests responsive.\n",
      );
      commitFixture(discoveryScope);

      const artifactDir = ".kota/runs/worker-boundary/repo-ai-checks";
      let timerFired = false;
      const timer = setTimeout(() => {
        timerFired = true;
      }, 0);
      const [decomposition, discovery] = await Promise.all([
        runWorkflowBlockingOperation(applyDecompositionOperation, {
          workspaceRoot: decomposerProject,
          stateDir,
          assessment: {
            shouldDecompose: true,
            reason: "builder exhausted repair on worker-boundary fixture",
            failedRunId,
            failedRunDir,
            failureKind: "repair-exhausted",
            taskId: decompositionTaskId,
            taskPath: decompositionTask.path,
            taskMarkdown: decompositionTask.content,
          },
          plan: {
            rationale: "Create one independently verifiable worker-boundary slice.",
            subtasks: [
              {
                title: "Worker decomposition slice",
                priority: "p1",
                problem: "The original work requires a smaller execution unit.",
                desiredOutcome: "The bounded slice is independently verifiable.",
                constraints: ["Preserve the original task intent."],
                howWeWillKnow: ["The bounded result is observable through the worker boundary."],
                dependsOn: [],
              },
            ],
          },
        }),
        runWorkflowBlockingOperation(discoverRepoAiChecksOperation, {
          workspaceRoot: discoveryScope,
          artifactDir,
          artifactDirPath: join(discoveryScope, artifactDir),
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
      expect(decomposition).toEqual({
        taskId: "task-worker-decomposition",
        subtaskIds: ["task-worker-decomposition-slice"],
      });
      expect(
        existsSync(
          join(
            decomposerProject,
            "data/tasks/archive/task-worker-decomposition.md",
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
        existsSync(join(discoveryScope, artifactDir, "discovery.json")),
      ).toBe(true);
    } finally {
      rmSync(decomposerProject, { recursive: true, force: true });
      rmSync(discoveryScope, { recursive: true, force: true });
    }
  });
});
