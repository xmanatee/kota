import { join } from "node:path";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type { WorkflowAgentStep } from "./step-types.js";

const MIN_MARKDOWN_FENCE_LENGTH = 3;

function maxBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function markdownFenceForContent(value: string): string {
  return "`".repeat(Math.max(MIN_MARKDOWN_FENCE_LENGTH, maxBacktickRun(value) + 1));
}

function escapeUntrustedBlockText(value: string): string {
  return value.replace(/[<>&]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    return "\\u0026";
  });
}

function renderFailureOutput(failure: RepairCheckResult): string[] {
  const output = escapeUntrustedBlockText(failure.output.trim());
  const fence = markdownFenceForContent(output);
  return [
    `## ${failure.id}`,
    '<untrusted-content source="repair-check.output">',
    fence,
    output,
    fence,
    "</untrusted-content>",
    "",
  ];
}

export function buildRepairPrompt(
  attempt: number,
  maxRepairAttempts: number | undefined,
  failures: RepairCheckResult[],
  step: WorkflowAgentStep,
  runDirPath?: string,
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
    "Fix these issues now. KOTA stages workspace changes for review after you stop; do not run `git add` or `git commit`.",
    `Write a short commit message to \`${commitMessagePath}\` summarizing what changed.`,
    "Finish this repair fully, then stop.",
  );
  return lines.join("\n");
}
