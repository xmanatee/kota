import type {
  OwnerDecisionJsonObject,
} from "#core/daemon/owner-decision-store.js";
import type { ReferenceProviderActionResult } from "./matching-types.js";

function ownerString(input: OwnerDecisionJsonObject, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function executeReferenceProviderAction(
  input: OwnerDecisionJsonObject,
  failProviderActionIds: readonly string[],
): ReferenceProviderActionResult {
  const providerActionId = ownerString(input, "providerActionId");
  if (failProviderActionIds.includes(providerActionId)) {
    throw new Error(`dry-run provider action failed: ${providerActionId}`);
  }
  const providerAdapter = ownerString(input, "providerAdapter");
  const opportunityId = ownerString(input, "opportunityId");
  return {
    ok: true,
    dryRun: true,
    providerAdapter,
    providerActionId,
    opportunityId,
    message: `Dry-run ${providerAdapter} action ${providerActionId} for ${opportunityId}`,
  };
}
