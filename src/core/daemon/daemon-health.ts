import type { WorkflowAgentOperatingState } from "#core/workflow/trigger-types.js";
import type {
  HealthStatus,
  ModuleHealthCheckResult,
} from "./daemon-health-types.js";
import type { EventLoopLatencySnapshot } from "./event-loop-latency.js";

export function buildDaemonHealthStatus(
  checks: Record<string, ModuleHealthCheckResult>,
  eventLoop: EventLoopLatencySnapshot | undefined,
  agentOperatingState?: WorkflowAgentOperatingState,
): HealthStatus {
  const hasUnhealthy = Object.values(checks).some(
    (check) => check.status === "unhealthy",
  );
  return {
    scheduler: "ok",
    modules: hasUnhealthy ? "error" : "ok",
    ...(agentOperatingState !== undefined ? { agentOperatingState } : {}),
    ...(eventLoop !== undefined ? { eventLoop } : {}),
    ...(Object.keys(checks).length > 0 ? { moduleHealthChecks: checks } : {}),
  };
}
