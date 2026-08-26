import type { WorkflowCommandRunner } from "../workflow-command.js";

export const successfulWorkflowCommandRun: WorkflowCommandRunner = async (input) => ({
  command: input.command,
  args: input.args ?? [],
  cwd: input.cwd ?? process.cwd(),
  identity: {
    pid: 1,
    processGroupId: 1,
    observedCommandHash: "workflow-test-command",
    osStartToken: "workflow-test-command",
  },
  exitCode: 0,
  stdout: { text: "", totalBytes: 0, truncated: false },
  stderr: { text: "", totalBytes: 0, truncated: false },
});

export const unexpectedWorkflowCommandRun: WorkflowCommandRunner = (input) =>
  Promise.reject(
    new Error(`Unexpected workflow command execution: ${input.command}`),
  );
