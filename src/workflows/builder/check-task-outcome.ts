import { existsSync } from "node:fs";
import { join } from "node:path";

export type TaskFinalState = "done" | "doing" | "ready" | "missing";

export type CheckTaskOutcomeResult = {
  taskId: string;
  resolved: boolean;
  finalState: TaskFinalState;
};

export function checkTaskOutcome(
  projectDir: string,
  taskId: string,
): CheckTaskOutcomeResult {
  const states: TaskFinalState[] = ["done", "doing", "ready"];
  for (const state of states) {
    if (existsSync(join(projectDir, "tasks", state, `${taskId}.md`))) {
      return { taskId, resolved: state === "done", finalState: state };
    }
  }
  return { taskId, resolved: false, finalState: "missing" };
}
