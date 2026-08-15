import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function rejectUnadmittedWorkflowTrigger(args: {
  definition: WorkflowDefinition;
  projectDir: string;
  trigger: WorkflowRunTrigger;
  log: (message: string) => void;
}): boolean {
  const admission = args.definition.triggerAdmission?.({
    projectDir: args.projectDir,
    workflowName: args.definition.name,
    trigger: args.trigger,
  });
  if (admission?.admitted !== false) return false;
  args.log(
    `Skipped workflow "${args.definition.name}" from event "${args.trigger.event}" before queue insertion: ${admission.reason}`,
  );
  return true;
}
