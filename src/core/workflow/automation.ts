import type { WorkflowTriggerInput } from "./trigger-types.js";
import type { WorkflowDefinitionInput } from "./types.js";

export type AutomationKind = "automation" | "hook";

export type AutomationDefinitionInput = Omit<WorkflowDefinitionInput, "triggers"> & {
  kind: AutomationKind;
  on: WorkflowTriggerInput | readonly WorkflowTriggerInput[];
};

export type HookDefinitionInput = Omit<AutomationDefinitionInput, "kind"> & {
  kind?: "hook";
};

export function defineAutomation(
  definition: AutomationDefinitionInput,
): WorkflowDefinitionInput {
  const { kind: _kind, on, ...workflow } = definition;
  return {
    ...workflow,
    triggers: Array.isArray(on) ? [...on] : [on],
  };
}

export function defineHook(definition: HookDefinitionInput): WorkflowDefinitionInput {
  return defineAutomation({ ...definition, kind: "hook" });
}
