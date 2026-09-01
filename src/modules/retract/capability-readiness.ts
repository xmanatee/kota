import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";

export function createRetractReadinessSource(): CapabilityReadinessSource {
  return {
    moduleName: "retract",
    probe(): CapabilityReadiness[] {
      return [
        {
          id: "retract",
          moduleName: "retract",
          status: "ready",
          message: "Retract is available for memory, knowledge, tasks, and inbox.",
        },
      ];
    },
  };
}
