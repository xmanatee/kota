import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "../../workflow/types.js";

export type RecoveryResult = {
  triggeringStatus: string | null;
  recovered: string[];
};

export function recoverDoingTasks(ctx: WorkflowStepContext): RecoveryResult {
  const { projectDir, trigger } = ctx;

  const triggeringStatus =
    typeof trigger.payload.status === "string" ? trigger.payload.status : null;

  if (triggeringStatus !== "failed") {
    return { triggeringStatus, recovered: [] };
  }

  const doingDir = join(projectDir, "tasks", "doing");
  if (!existsSync(doingDir)) {
    return { triggeringStatus, recovered: [] };
  }

  const files = readdirSync(doingDir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  );

  const recovered: string[] = [];

  for (const file of files) {
    const srcPath = join(doingDir, file);
    const dstPath = join(projectDir, "tasks", "ready", file);
    const content = readFileSync(srcPath, "utf-8");
    const updated = content.replace(/^status:\s*doing$/m, "status: ready");
    writeFileSync(dstPath, updated, "utf-8");
    unlinkSync(srcPath);
    recovered.push(file);
  }

  return { triggeringStatus, recovered };
}
