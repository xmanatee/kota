import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function taskFilesInState(projectDir: string, state: "ready" | "doing" | "done" | "blocked"): string[] {
  const dir = join(projectDir, "data/tasks", state);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "AGENTS.md")
    .sort();
}

export function checkActionableTaskClaimed(projectDir: string): string {
  const ready = taskFilesInState(projectDir, "ready");
  if (ready.length === 0) return "OK: no unclaimed ready task";

  const claimedCount =
    taskFilesInState(projectDir, "doing").length +
    taskFilesInState(projectDir, "done").length +
    taskFilesInState(projectDir, "blocked").length;
  if (claimedCount > 0) return `OK: task claimed (${claimedCount} active or terminal task file(s))`;

  throw new Error(
    `Builder has ${ready.length} ready task(s) but has not claimed one. ` +
      'Move one ready task to doing with `node "$KOTA_DIST_DIR/cli.js" task move <id> doing` ' +
      "or `pnpm kota task move <id> doing` in package projects, " +
      "then complete it or block it according to the task's Done When section.",
  );
}

export function checkActionableTaskResolved(projectDir: string): string {
  const doing = taskFilesInState(projectDir, "doing");
  if (doing.length === 0) return "OK: no in-progress task left open";

  throw new Error(
    `Builder still has ${doing.length} task(s) in doing: ${doing.join(", ")}. ` +
      "Before completing the workflow, move finished work to done or honestly move blocked work to blocked.",
  );
}
