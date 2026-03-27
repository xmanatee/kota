import builderWorkflow from "../workflows/builder/workflow.js";
import explorerWorkflow from "../workflows/explorer/workflow.js";
import improverWorkflow from "../workflows/improver/workflow.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import { registerWorkflowDefinition } from "./validation.js";

export function getBuiltinWorkflowDefinitions(): RegisteredWorkflowDefinitionInput[] {
  return [
    registerWorkflowDefinition(
      "src/workflows/explorer/workflow.ts",
      explorerWorkflow,
    ),
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

export function getRegisteredWorkflowDefinitions(
  contributed: readonly RegisteredWorkflowDefinitionInput[] = [],
): RegisteredWorkflowDefinitionInput[] {
  return [...getBuiltinWorkflowDefinitions(), ...contributed];
}
