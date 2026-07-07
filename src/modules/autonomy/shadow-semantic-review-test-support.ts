import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { ExecutableShadowSemanticReviewerDeclaration } from "./shadow-semantic-review.js";

export function makeShadowReviewContext(
  projectDir: string,
  runDirPath: string,
): WorkflowStepContext {
  return {
    projectDir,
    workspaceDir: projectDir,
    workflow: {
      name: "fixture-workflow",
      definitionPath: "src/modules/autonomy/workflows/fixture/workflow.ts",
      runId: "run-shadow-fixture",
      runDir: ".kota/runs/run-shadow-fixture",
      runDirPath,
    },
    trigger: { event: "fixture", payload: {}, schemaRef: null },
    previousOutput: null,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: async () => ({ content: "" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: () => {},
    triggerWorkflow: async () => ({ runId: "queued", status: "queued" }),
  };
}

export function baseShadowReviewDeclaration(
  overrides: Partial<ExecutableShadowSemanticReviewerDeclaration> = {},
): ExecutableShadowSemanticReviewerDeclaration {
  return {
    id: "fixture-shadow-review",
    mode: "advisory",
    targetKind: "task-queue",
    promotionCandidateRef: "task-run-shadow-semantic-reviewers-for-non-builder-auto#fixture",
    reviewer: {
      id: "fixture-reviewer-v1",
      systemPrompt: "Review only declared artifacts.",
      question: "Does the target satisfy the workflow-specific review question?",
    },
    targetResolver: () => ({
      kind: "target",
      target: {
        id: "target-one",
        kind: "task-queue",
        summary: "Fixture target.",
        artifacts: [
          { path: "artifact:diff", content: "diff --git a/data/inbox/x b/data/tasks/ready/y" },
        ],
      },
    }),
    ...overrides,
  };
}

export function makeShadowReviewDirs(): { projectDir: string; runDirPath: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "shadow-review-"));
  const runDirPath = join(projectDir, ".kota", "runs", "run-shadow-fixture");
  mkdirSync(runDirPath, { recursive: true });
  return { projectDir, runDirPath };
}

export function git(projectDir: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function writeProjectFile(projectDir: string, path: string, content: string): void {
  const absolutePath = join(projectDir, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}
