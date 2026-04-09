import type { RegisteredWorkflowDefinitionInput } from "./types.js";
export { getBuiltinWorkflowDefinitions } from "../workflows/catalog.js";

export function getRegisteredWorkflowDefinitions(
  contributed: readonly RegisteredWorkflowDefinitionInput[] = [],
): RegisteredWorkflowDefinitionInput[] {
  return [...getBuiltinWorkflowDefinitions(), ...contributed];
}
