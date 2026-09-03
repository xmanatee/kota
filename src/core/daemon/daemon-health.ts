import type { WorkflowAgentOperatingState } from "#core/workflow/trigger-types.js";
import type {
  HealthStatus,
  ModuleHealthCheckResult,
  PublicHealthStatus,
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

/** Project the unauthenticated liveness response without diagnostic text. */
export function projectPublicHealthStatus(
  health: HealthStatus,
): PublicHealthStatus {
  const agentOperatingState = health.agentOperatingState === undefined
    ? undefined
    : {
      runtimeId: health.agentOperatingState.runtimeId,
      state: health.agentOperatingState.state,
      ...(health.agentOperatingState.resumeAt === undefined
        ? {}
        : { resumeAt: health.agentOperatingState.resumeAt }),
    };
  const moduleHealthChecks = health.moduleHealthChecks === undefined
    ? undefined
    : Object.fromEntries(
      Object.entries(health.moduleHealthChecks).map(([name, check]) => [
        name,
        { status: check.status },
      ]),
    );
  return {
    scheduler: health.scheduler,
    modules: health.modules,
    ...(agentOperatingState === undefined ? {} : { agentOperatingState }),
    ...(health.eventLoop === undefined ? {} : { eventLoop: health.eventLoop }),
    ...(moduleHealthChecks === undefined ? {} : { moduleHealthChecks }),
  };
}
