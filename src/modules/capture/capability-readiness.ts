import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";

export function createCaptureReadinessSource(): CapabilityReadinessSource {
  return {
    moduleName: "capture",
    probe(): CapabilityReadiness[] {
      return [
        {
          id: "capture",
          moduleName: "capture",
          status: "ready",
          message: "Capture is available for memory, knowledge, tasks, and inbox.",
        },
      ];
    },
  };
}
