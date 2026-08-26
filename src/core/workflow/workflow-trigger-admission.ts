import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function rejectUnadmittedWorkflowTrigger(args: {
  definition: WorkflowDefinition;
  projectDir: string;
  stateDir: string;
  projectId: string;
  runState: RunStateDatabase;
  trigger: WorkflowRunTrigger;
  log: (message: string) => void;
}): boolean {
  const admission = args.definition.triggerAdmission?.({
    projectDir: args.projectDir,
    stateDir: args.stateDir,
    workflowName: args.definition.name,
    trigger: args.trigger,
    state: {
      read: (key) => args.runState.readProjectStateValue(args.projectId, key),
    },
  });
  if (admission?.admitted !== false) return false;
  args.log(
    `Skipped workflow "${args.definition.name}" from event "${args.trigger.event}" before queue insertion: ${admission.reason}`,
  );
  return true;
}
