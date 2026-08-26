import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function rejectUnadmittedWorkflowTrigger(args: {
  definition: WorkflowDefinition;
  scopeRoot: string;
  stateDir: string;
  scopeId: string;
  runState: RunStateDatabase;
  trigger: WorkflowRunTrigger;
  log: (message: string) => void;
}): boolean {
  const admission = args.definition.triggerAdmission?.({
    scopeRoot: args.scopeRoot,
    stateDir: args.stateDir,
    workflowName: args.definition.name,
    trigger: args.trigger,
    state: {
      read: (key) => args.runState.readScopeStateValue(args.scopeId, key),
    },
  });
  if (admission?.admitted !== false) return false;
  args.log(
    `Skipped workflow "${args.definition.name}" from event "${args.trigger.event}" before queue insertion: ${admission.reason}`,
  );
  return true;
}
