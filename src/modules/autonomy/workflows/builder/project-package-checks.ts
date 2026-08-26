import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  type WorkflowCommandInput,
  workflowCommandOutput,
} from "#core/workflow/workflow-command.js";

const PACKAGE_PROJECT_MARKERS = [
  "package.json",
  "package.yaml",
  "package.json5",
  "pnpm-workspace.yaml",
] as const;

function hasPackageProject(projectDir: string): boolean {
  return PACKAGE_PROJECT_MARKERS.some((marker) =>
    existsSync(join(projectDir, marker))
  );
}

export async function checkPackageScript(
  context: Pick<WorkflowStepContext, "runCommand">,
  projectDir: string,
  command: Omit<WorkflowCommandInput, "cwd" | "signal">,
): Promise<string> {
  if (!hasPackageProject(projectDir)) {
    return "OK: no package project present";
  }
  return workflowCommandOutput(await context.runCommand({
    ...command,
    cwd: projectDir,
  }));
}

export async function checkMacosSwiftBuild(
  context: Pick<WorkflowStepContext, "runCommand">,
  projectDir: string,
): Promise<string> {
  const appleDir = join(projectDir, "clients/apple");
  if (!existsSync(join(appleDir, "Package.swift"))) {
    return "OK: no Apple client present";
  }
  return workflowCommandOutput(await context.runCommand({
    command: "swift",
    args: ["build"],
    cwd: appleDir,
    timeoutMs: 180_000,
  }));
}
