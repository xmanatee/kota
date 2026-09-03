import type { WorkflowAgentOperatingState } from "#core/workflow/trigger-types.js";
import type { EventLoopLatencySnapshot } from "./event-loop-latency.js";

export type ComponentStatus = "ok" | "error";

export type ModuleHealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
};

export type HealthStatus = {
  scheduler: ComponentStatus;
  modules: ComponentStatus;
  agentOperatingState?: WorkflowAgentOperatingState;
  eventLoop?: EventLoopLatencySnapshot;
  moduleHealthChecks?: Record<string, ModuleHealthCheckResult>;
};

export type PublicHealthStatus = {
  scheduler: ComponentStatus;
  modules: ComponentStatus;
  agentOperatingState?: Omit<WorkflowAgentOperatingState, "reason">;
  eventLoop?: EventLoopLatencySnapshot;
  moduleHealthChecks?: Record<string, Pick<ModuleHealthCheckResult, "status">>;
};
