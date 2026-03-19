import builderWorkflow from "../workflows/builder/workflow.js";
import improverWorkflow from "../workflows/improver/workflow.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import { registerWorkflowDefinition } from "./validation.js";

export function getBuiltinWorkflowDefinitions(): RegisteredWorkflowDefinitionInput[] {
  return [
    registerWorkflowDefinition(
      "src/workflows/builder/workflow.ts",
      builderWorkflow,
    ),
    registerWorkflowDefinition(
      "src/workflows/improver/workflow.ts",
      improverWorkflow,
    ),
  ];
}
