import attentionDigestWorkflow from "../workflows/attention-digest/workflow.js";
import builderWorkflow from "../workflows/builder/workflow.js";
import explorerWorkflow from "../workflows/explorer/workflow.js";
import inboxSorterWorkflow from "../workflows/inbox-sorter/workflow.js";
import improverWorkflow from "../workflows/improver/workflow.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import { registerWorkflowDefinition } from "./validation.js";

export function getBuiltinWorkflowDefinitions(): RegisteredWorkflowDefinitionInput[] {
  return [
    registerWorkflowDefinition(
      "src/workflows/inbox-sorter/workflow.ts",
      inboxSorterWorkflow,
    ),
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
    registerWorkflowDefinition(
      "src/workflows/attention-digest/workflow.ts",
      attentionDigestWorkflow,
    ),
  ];
}

export function getRegisteredWorkflowDefinitions(
  contributed: readonly RegisteredWorkflowDefinitionInput[] = [],
): RegisteredWorkflowDefinitionInput[] {
  return [...getBuiltinWorkflowDefinitions(), ...contributed];
}
