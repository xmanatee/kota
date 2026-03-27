import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import { loadRunsInWindow } from "../../workflow-history.js";

const FAILED_ATTEMPT_THRESHOLD = 2;
const LOOKUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type RecoveryResult = {
  triggeringStatus: string | null;
  recovered: string[];
  blocked: string[];
};

function countRecentFailedBuilderAttempts(runsDir: string, taskId: string): number {
  const cutoffMs = Date.now() - LOOKUP_WINDOW_MS;
  const runs = loadRunsInWindow(runsDir, cutoffMs);
  let count = 0;
  for (const run of runs) {
    if (run.workflow !== "builder") continue;
    if (run.status !== "failed" && run.status !== "interrupted") continue;
    const claimStep = run.steps.find((s) => s.id === "claim-task");
    if (!claimStep?.output || typeof claimStep.output !== "object") continue;
    const output = claimStep.output as Record<string, unknown>;
    if (output.chosenTaskId === taskId) count++;
  }
  return count;
}

export function recoverDoingTasks(ctx: WorkflowStepContext): RecoveryResult {
  const { projectDir, trigger } = ctx;

  const triggeringStatus =
    typeof trigger.payload.status === "string" ? trigger.payload.status : null;

  if (triggeringStatus !== "failed" && triggeringStatus !== "interrupted") {
    return { triggeringStatus, recovered: [], blocked: [] };
  }

  const doingDir = join(projectDir, "tasks", "doing");
  if (!existsSync(doingDir)) {
    return { triggeringStatus, recovered: [], blocked: [] };
  }

  const files = readdirSync(doingDir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  );

  const runsDir = join(projectDir, ".kota", "runs");
  const recovered: string[] = [];
  const blocked: string[] = [];

  for (const file of files) {
    const srcPath = join(doingDir, file);
    const taskId = file.replace(/\.md$/, "");
    const failedAttempts = countRecentFailedBuilderAttempts(runsDir, taskId);
    const content = readFileSync(srcPath, "utf-8");

    if (failedAttempts >= FAILED_ATTEMPT_THRESHOLD) {
      const blockedDir = join(projectDir, "tasks", "blocked");
      mkdirSync(blockedDir, { recursive: true });
      const dstPath = join(blockedDir, file);
      const note = `\n\n## Blocker\n\nAutomatically escalated after ${failedAttempts} consecutive failed builder attempts.\n`;
      const updated = content.replace(/^status:\s*doing$/m, "status: blocked") + note;
      writeFileSync(dstPath, updated, "utf-8");
      unlinkSync(srcPath);
      blocked.push(file);
    } else {
      const dstPath = join(projectDir, "tasks", "ready", file);
      const updated = content.replace(/^status:\s*doing$/m, "status: ready");
      writeFileSync(dstPath, updated, "utf-8");
      unlinkSync(srcPath);
      recovered.push(file);
    }
  }

  return { triggeringStatus, recovered, blocked };
}
