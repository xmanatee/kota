/**
 * Core contract for the workflow-definitions read-only provider.
 *
 * The daemon owns the loaded workflow definitions and registers an
 * implementation at startup. Modules that contribute daemon-control routes
 * which need to read pre-dispatch policy from a workflow definition (today
 * the webhook module's per-workflow `webhookRateLimit` for inbound trigger
 * gating) look the source up through the provider registry. The seam is
 * read-only and intentionally narrow — it exposes only the slice of a
 * `WorkflowDefinition` that module routes need, so modules do not import
 * `#core/workflow/...` runtime internals.
 */

import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";

export type WorkflowDefinitionsSource = {
  /**
   * Returns the configured webhook rate limit for the named workflow, or
   * `undefined` when the workflow has no rate limit configured (or the
   * workflow does not exist). Module handlers gate inbound deliveries on
   * this value and update their own sliding-window state.
   */
  getWebhookRateLimit(name: string): { maxPerMinute: number } | undefined;
};

/** Provider-registry token used to look up the active workflow-definitions source. */
export const WORKFLOW_DEFINITIONS_PROVIDER_TYPE: ProviderToken<WorkflowDefinitionsSource> =
  defineProviderToken<WorkflowDefinitionsSource>("workflow-definitions");

/**
 * Look up the active workflow-definitions source. Returns `null` when no
 * daemon has registered one (e.g. a CLI process or a test that built routes
 * against a standalone control server). Callers should respond with 503 in
 * that case so the wire contract for affected control routes stays
 * consistent with the `workflow-dispatcher` seam.
 */
export function getWorkflowDefinitionsSource(): WorkflowDefinitionsSource | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get(WORKFLOW_DEFINITIONS_PROVIDER_TYPE);
}
