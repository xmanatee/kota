import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VerifyClaimResult = {
  taskId: string;
  verified: true;
};

export function verifyClaim(
  projectDir: string,
  chosenTaskId: string,
): VerifyClaimResult {
  const taskPath = join(projectDir, "tasks", "doing", `${chosenTaskId}.md`);

  if (!existsSync(taskPath)) {
    throw new Error(
      `verify-claim: task file not found in doing/ — expected ${taskPath}`,
    );
  }

  const content = readFileSync(taskPath, "utf-8");
  const statusMatch = content.match(/^status:\s*(\S+)/m);
  const status = statusMatch?.[1];

  if (status !== "doing") {
    throw new Error(
      `verify-claim: task ${chosenTaskId} has status "${status}", expected "doing"`,
    );
  }

  return { taskId: chosenTaskId, verified: true };
}
