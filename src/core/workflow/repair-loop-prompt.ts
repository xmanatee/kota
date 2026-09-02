import { join } from "node:path";
import { WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION } from "#core/agent-harness/native-cli-workflow-rails.js";
import { renderUntrustedContent } from "#core/util/untrusted-content.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type { WorkflowAgentStep } from "./step-types.js";

function renderFailureOutput(failure: RepairCheckResult): string[] {
  return [
    `## ${failure.id}`,
    ...renderUntrustedContent({
      source: "repair-check.output",
      content: failure.output.trim(),
    }).lines,
    "",
  ];
}

export function buildRepairPrompt(
  attempt: number,
  maxRepairAttempts: number | undefined,
  failures: RepairCheckResult[],
  step: WorkflowAgentStep,
  runDirPath?: string,
  includeGitOwnershipInstruction = true,
): string {
  const attemptLabel = maxRepairAttempts === undefined
    ? `${attempt}`
    : `${attempt}/${maxRepairAttempts}`;
  const lines = [
    `Post-check repair attempt ${attemptLabel} for step "${step.id}".`,
    "",
    "The following checks failed after your previous work:",
    "",
  ];
  for (const failure of failures) {
    lines.push(...renderFailureOutput(failure));
  }
  if (runDirPath) {
    lines.push("Run directory:", runDirPath, "");
  }
  const commitMessagePath = runDirPath
    ? join(runDirPath, "commit-message.txt")
    : "<run-directory>/commit-message.txt";
  lines.push(
    "Fix these issues now.",
    ...(includeGitOwnershipInstruction
      ? [WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION]
      : []),
    `Write a short commit message to \`${commitMessagePath}\` summarizing what changed.`,
    "Finish this repair fully, then stop.",
  );
  return lines.join("\n");
}
