import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowRepairContinuationInput } from "#core/workflow/run-types.js";

export const CONTINUATION_TASK_ID = "task-long-builder";

export function continuationTaskContent(input: {
  id: string;
  title: string;
  status: "doing" | "ready";
  priority: string;
  taskClass: string;
}): string {
  return `---
id: ${input.id}
title: ${input.title}
status: ${input.status}
priority: ${input.priority}
area: autonomy
task_class: ${input.taskClass}
summary: Exercise an evidence-driven continuation boundary.
created_at: 2026-08-13T00:00:00.000Z
updated_at: 2026-08-13T00:00:00.000Z
---

## Done When

- The trajectory reaches an inspectable continuation decision.

## Acceptance Evidence

- A focused replay records the boundary.
`;
}

function initRepo(projectDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "builder@example.com"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "Builder Test"], {
    cwd: projectDir,
  });
  mkdirSync(join(projectDir, "data/tasks/doing"), { recursive: true });
  mkdirSync(join(projectDir, "data/tasks/ready"), { recursive: true });
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(
    join(projectDir, `data/tasks/doing/${CONTINUATION_TASK_ID}.md`),
    continuationTaskContent({
      id: CONTINUATION_TASK_ID,
      title: "Long builder",
      status: "doing",
      priority: "p1",
      taskClass: "Meta",
    }),
  );
  writeFileSync(join(projectDir, "src/work.ts"), "export const work = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
  writeFileSync(join(projectDir, "src/work.ts"), "export const work = 2;\n");
}

export function createContinuationInspectionFixture(): {
  projectDir: string;
  runDir: string;
  agentRunDir: string;
} {
  const projectDir = mkdtempSync(join(tmpdir(), "builder-continuation-"));
  initRepo(projectDir);
  const runDir = join(projectDir, ".kota/runs/run-long-builder");
  const agentRunDir = join(
    projectDir,
    ".kota/builder-evidence/run-long-builder",
  );
  mkdirSync(runDir, { recursive: true });
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. Finish.\n");
  return { projectDir, runDir, agentRunDir };
}

export function continuationTrajectory(
  failureIdsByAttempt: string[][],
  failureIds: string[],
  progressChanged = true,
): WorkflowRepairContinuationInput {
  return {
    attempt: 3,
    failureIds,
    warningIds: [],
    progressKey: "current-progress",
    previousProgressKey: "previous-progress",
    progressChanged,
    noProgressAttempts: progressChanged ? 0 : 1,
    repairIterations: failureIdsByAttempt.map((ids, index) => ({
      attempt: index + 1,
      failureIds: ids,
    })),
  };
}
