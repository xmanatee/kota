import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type {
  WorkflowBatchDispatchInput,
  WorkflowBatchDispatchResult,
} from "./event-batches.js";

export type WorkflowEventDispatcher = {
  enqueueBatchedEvent(
    input: WorkflowBatchDispatchInput,
  ): WorkflowBatchDispatchResult;
};

export const WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE: ProviderToken<WorkflowEventDispatcher> =
  defineProviderToken<WorkflowEventDispatcher>("workflow-event-dispatcher");

export function getWorkflowEventDispatcher(): WorkflowEventDispatcher | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get(WORKFLOW_EVENT_DISPATCHER_PROVIDER_TYPE);
}
