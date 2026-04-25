/**
 * Core contract for the workflow dispatcher provider.
 *
 * The daemon owns the actual workflow runtime and registers an implementation
 * at startup. Modules that contribute daemon-control routes which need to
 * trigger workflow runs (without holding a `DaemonControlHandle`) look the
 * dispatcher up through the provider registry per request. This keeps the
 * core daemon handle out of module surface area while exposing only the
 * dispatch capability the route handler needs.
 *
 * The shape mirrors `DaemonControlHandle.enqueuePendingRun` so handlers
 * forward the result envelope verbatim.
 */

import { getProviderRegistry } from "#core/modules/provider-registry.js";

/** Provider-registry key used to look up the active workflow dispatcher. */
export const WORKFLOW_DISPATCHER_PROVIDER_TYPE = "workflow-dispatcher";

export type EnqueuePendingRunResult = {
  ok: boolean;
  queued?: string;
  runId?: string;
  alreadyQueued?: boolean;
  error?: string;
};

export type WorkflowDispatcher = {
  /**
   * Enqueue a pending workflow run by name. Returns the same envelope as
   * `DaemonControlHandle.enqueuePendingRun` so module handlers can forward it
   * directly.
   */
  enqueuePendingRun(name: string): EnqueuePendingRunResult;
};

/**
 * Look up the active workflow dispatcher. Returns `null` when no daemon has
 * registered one (e.g. a CLI process or a test that built routes against a
 * standalone control server). Callers should respond with 503 in that case
 * so the wire contract for affected control routes stays consistent.
 */
export function getWorkflowDispatcher(): WorkflowDispatcher | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get<WorkflowDispatcher>(WORKFLOW_DISPATCHER_PROVIDER_TYPE);
}
