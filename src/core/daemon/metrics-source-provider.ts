/**
 * Core contract for the daemon metrics source provider.
 *
 * The daemon owns live workflow runtime state (metric counts, sessions,
 * dispatch state, active runs, queue depth). Modules that contribute
 * daemon-control routes which need to render those reads — today the
 * tracing module's `GET /metrics` Prometheus exposition — look the source
 * up through the provider registry per request. This keeps the
 * `DaemonControlHandle` out of module surface area while exposing only
 * the read capability the route handler needs.
 *
 * The shape mirrors the slice of `DaemonControlHandle` used by the
 * pre-existing core metrics handler so handlers forward the read results
 * verbatim.
 */

import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type {
  InteractiveSession,
  WorkflowLiveStatus,
  WorkflowMetricCounts,
} from "./daemon-control-types.js";

/** Provider-registry key used to look up the active metrics source. */
export const WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE = "workflow-metrics-source";

export type WorkflowMetricsSource = {
  /** Lifetime workflow run counts, cost totals, and duration histogram. */
  getWorkflowMetricCounts(): WorkflowMetricCounts;
  /** Currently-registered interactive sessions (serve + daemon). */
  listSessions(): InteractiveSession[];
  /** Current workflow runtime live status (paused, active runs, queue length). */
  getWorkflowLiveStatus(): WorkflowLiveStatus;
};

/**
 * Look up the active metrics source. Returns `null` when no daemon has
 * registered one (e.g. a CLI process or a test that built routes against a
 * standalone control server). Callers should respond with 503 in that case
 * so the wire contract for affected control routes stays consistent.
 */
export function getWorkflowMetricsSource(): WorkflowMetricsSource | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get<WorkflowMetricsSource>(WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE);
}
