import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TaskFinalState = "done" | "doing" | "ready" | "missing";

export type CheckTaskOutcomeResult = {
  taskId: string;
  resolved: boolean;
  finalState: TaskFinalState;
};

export type FailureAnnotation = {
  runId: string;
  summary: string;
  date: string;
};

export function checkTaskOutcome(
  projectDir: string,
  taskId: string,
  annotation?: FailureAnnotation,
): CheckTaskOutcomeResult {
  const states: TaskFinalState[] = ["done", "doing", "ready"];
  for (const state of states) {
    const filePath = join(projectDir, "tasks", state, `${taskId}.md`);
    if (existsSync(filePath)) {
      const resolved = state === "done";
      if (!resolved && annotation) {
        appendFailureAnnotation(filePath, annotation);
      }
      return { taskId, resolved, finalState: state };
    }
  }
  return { taskId, resolved: false, finalState: "missing" };
}

function appendFailureAnnotation(
  filePath: string,
  annotation: FailureAnnotation,
): void {
  const content = readFileSync(filePath, "utf8");
  const bullet = `- ${annotation.date} | ${annotation.runId} | ${annotation.summary}`;
  const historyHeading = "## Attempt History";

  if (content.includes(historyHeading)) {
    writeFileSync(filePath, `${content.trimEnd()}\n${bullet}\n`);
  } else {
    writeFileSync(
      filePath,
      `${content.trimEnd()}\n\n${historyHeading}\n${bullet}\n`,
    );
  }
}
