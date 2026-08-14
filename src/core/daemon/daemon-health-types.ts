import type { EventLoopLatencySnapshot } from "./event-loop-latency.js";

export type ComponentStatus = "ok" | "error";

export type ModuleHealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
};

export type HealthStatus = {
  scheduler: ComponentStatus;
  modules: ComponentStatus;
  eventLoop?: EventLoopLatencySnapshot;
  moduleHealthChecks?: Record<string, ModuleHealthCheckResult>;
};
