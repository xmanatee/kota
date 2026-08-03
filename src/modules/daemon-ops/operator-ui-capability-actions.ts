import type { KotaClient } from "#core/server/kota-client.js";
import type { UiActionExecutionResult } from "./operator-ui-actions.js";
import type { ClientNamespaceOperation } from "./operator-ui-capability-action-parameters.js";
import { executeContentCapabilityUiAction } from "./operator-ui-content-actions.js";
import type { UiJsonValue } from "./operator-ui-types.js";
import { executeWorkCapabilityUiAction } from "./operator-ui-work-actions.js";

export async function executeCapabilityUiAction(args: {
  client: KotaClient;
  operation: ClientNamespaceOperation;
  parameters?: UiJsonValue;
}): Promise<UiActionExecutionResult | null> {
  const contentResult = await executeContentCapabilityUiAction(args);
  if (contentResult !== null) return contentResult;
  return executeWorkCapabilityUiAction(args);
}
