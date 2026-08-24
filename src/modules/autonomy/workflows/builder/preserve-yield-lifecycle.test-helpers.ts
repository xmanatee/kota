import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  WorkflowRepairContinuationDecision,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import { claimTask } from "#modules/autonomy/task-claims.js";
import { checkpointAndReconcileAutomationWorktree } from "#modules/git/worktree-canonical-reconciliation.js";
import { updateAutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-canonical-reconciliation-metadata.js";
import { createAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import type { AutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-lifecycle-types.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";

export const lifecycleRoots: string[] = [];
export const PRESERVED_TASK_ID = "task-preserve-yield";
export const SAFETY_TASK_ID = "task-runtime-safety";
export const PRESERVED_RUN_ID = "run-preserve-yield";
export const CONTINUATION_RUN_ID = "run-preserve-yield-recovery";

export type PreserveYieldLifecycleFixture = {
  projectDir: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
};

export function fixtureGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function taskContent(input: {
  id: string;
  status: "doing" | "ready";
  priority: "p0" | "p1";
  taskClass: "Meta" | "Safety";
}): string {
  return `---
id: ${input.id}
title: ${input.id}
status: ${input.status}
priority: ${input.priority}
area: autonomy
task_class: ${input.taskClass}
summary: Exercise the preserve-yield lifecycle.
created_at: 2026-08-13T00:00:00.000Z
updated_at: 2026-08-13T00:00:00.000Z
---

## Done When

- The preserved task resumes without duplicate work.
`;
}

function writeBuilderEvidence(workspaceDir: string): void {
  const runDir = join(
    workspaceDir,
    ".kota",
    "builder-evidence",
    PRESERVED_RUN_ID,
  );
  writeFixtureFile(join(runDir, "success-criteria.txt"), "1. Preserve useful work.\n");
  writeFixtureFile(
    join(runDir, "success-criteria-verified.txt"),
    "1. Verified preserved work.\n",
  );
  writeFixtureFile(join(runDir, "commit-message.txt"), "Preserve useful work\n");
  writeFixtureFile(
    join(runDir, "evidence-manifest.json"),
    '{"schemaVersion":1,"artifacts":[]}\n',
  );
}

export function yieldedPreserveYieldMetadata(
  decision: WorkflowRepairContinuationDecision,
): WorkflowRunMetadata {
  return {
    id: PRESERVED_RUN_ID,
    workflow: "builder",
    status: "yielded",
    runDir: `.kota/runs/${PRESERVED_RUN_ID}`,
    steps: [
      {
        id: "prepare-worktree",
        output: { enabled: true, taskId: PRESERVED_TASK_ID },
      },
      {
        id: "build",
        type: "agent",
        status: "yielded",
        output: {
          continuationDecisions: [decision],
        },
      },
    ],
  } as WorkflowRunMetadata;
}

export function makePreserveYieldFixture(
  label: string,
): PreserveYieldLifecycleFixture {
  const projectDir = mkdtempSync(join(tmpdir(), `builder-${label}-`));
  lifecycleRoots.push(projectDir);
  fixtureGit(projectDir, ["init", "-q", "-b", "main"]);
  fixtureGit(projectDir, ["config", "user.email", "test@example.com"]);
  fixtureGit(projectDir, ["config", "user.name", "KOTA Test"]);
  writeFixtureFile(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n");
  writeFixtureFile(join(projectDir, "src/work.ts"), "export const work = 1;\n");
  fixtureGit(projectDir, ["add", "-A"]);
  fixtureGit(projectDir, ["commit", "-q", "-m", "base"]);

  const worktree = createAutomationWorktree({
    projectDir,
    taskId: PRESERVED_TASK_ID,
    runId: PRESERVED_RUN_ID,
    workflowId: "builder",
    owner: "workflow:builder",
  });
  writeFixtureFile(
    join(projectDir, "data/tasks/doing", `${PRESERVED_TASK_ID}.md`),
    taskContent({
      id: PRESERVED_TASK_ID,
      status: "doing",
      priority: "p1",
      taskClass: "Meta",
    }),
  );
  writeFixtureFile(
    join(projectDir, "data/tasks/ready", `${SAFETY_TASK_ID}.md`),
    taskContent({
      id: SAFETY_TASK_ID,
      status: "ready",
      priority: "p0",
      taskClass: "Safety",
    }),
  );
  fixtureGit(projectDir, ["add", "data/tasks"]);
  fixtureGit(projectDir, ["commit", "-q", "-m", "add queue tasks"]);

  const taskFile = readVerifiedRepoTaskFile(
    projectDir,
    "doing",
    PRESERVED_TASK_ID,
  );
  if (taskFile === null) throw new Error("fixture task is missing");
  const claimed = claimTask({
    projectDir,
    taskId: PRESERVED_TASK_ID,
    taskState: "doing",
    taskFile,
    runId: PRESERVED_RUN_ID,
    workflowId: "builder",
    owner: "workflow:builder",
    workspaceDir: worktree.metadata.workspaceDir,
    branch: worktree.branch,
    baseCommit: worktree.baseCommit,
  });
  if (!claimed.claimed) throw new Error(claimed.reason ?? "claim failed");

  writeBuilderEvidence(worktree.metadata.workspaceDir);
  writeFixtureFile(
    join(worktree.metadata.workspaceDir, "src/work.ts"),
    "export const work = 2;\n",
  );
  return {
    projectDir,
    workspaceDir: worktree.metadata.workspaceDir,
    branch: worktree.branch,
    baseCommit: worktree.baseCommit,
  };
}

export async function reconcilePreservedWork(
  fixture: PreserveYieldLifecycleFixture,
  recoveryRunId: string,
  artifactName: string,
): Promise<AutomationWorktreeCanonicalReconciliation> {
  const artifactPath = join(
    fixture.projectDir,
    ".kota/runs",
    recoveryRunId,
    artifactName,
  );
  return checkpointAndReconcileAutomationWorktree({
    projectDir: fixture.projectDir,
    taskId: PRESERVED_TASK_ID,
    runId: PRESERVED_RUN_ID,
    recoveryRunId,
    artifactPath,
    validationCommands: [[process.execPath, "-e", "process.exit(0)"]],
    onProgress: (record) => {
      writeFixtureFile(artifactPath, `${JSON.stringify(record, null, 2)}\n`);
      updateAutomationWorktreeCanonicalReconciliation(
        {
          projectDir: fixture.projectDir,
          taskId: PRESERVED_TASK_ID,
          runId: PRESERVED_RUN_ID,
        },
        record,
      );
    },
  });
}
