import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { CaptureProvider } from "./capture-types.js";

const MODULE_NAME = "capture";

export function createCaptureReadinessSource(
  provider: CaptureProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const sources = provider.contributors();
      if (sources.length === 0) {
        return [
          {
            id: "capture",
            moduleName: MODULE_NAME,
            status: "unavailable",
            reason: "no_contributors",
            message:
              "Capture has no registered contributors — load memory, knowledge, or repo-tasks.",
          },
        ];
      }
      return [
        {
          id: "capture",
          moduleName: MODULE_NAME,
          status: "ready",
          message: `Capture seam over ${sources.length} contributor(s).`,
          meta: { contributorCount: sources.length, sources: sources.join(",") },
        },
      ];
    },
  };
}
