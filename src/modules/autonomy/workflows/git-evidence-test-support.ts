import { execFileSync } from "node:child_process";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";

/** Real Git evidence with a controlled process launcher; core owns process supervision. */
export const runGitEvidenceCommand: WorkflowCommandRunner = async (input) => {
  if (input.command !== "git") {
    throw new Error(`Expected a Git evidence read, received ${input.command}`);
  }
  const text = execFileSync(input.command, input.args ?? [], {
    cwd: input.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ...await successfulWorkflowCommandRun(input),
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false },
  };
};
