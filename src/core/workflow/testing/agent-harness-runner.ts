import type { WorkflowAgentHarnessRunner } from "../run-types.js";

export const unexpectedWorkflowAgentHarnessRun: WorkflowAgentHarnessRunner =
  async () => {
    throw new Error("Unexpected nested agent harness invocation");
  };
