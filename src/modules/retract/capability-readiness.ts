import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { RetractProvider } from "./retract-types.js";

const MODULE_NAME = "retract";

export function createRetractReadinessSource(
  provider: RetractProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const sources = provider.contributors();
      if (sources.length === 0) {
        return [
          {
            id: "retract",
            moduleName: MODULE_NAME,
            status: "unavailable",
            reason: "no_contributors",
            message:
              "Retract has no registered contributors — load memory, knowledge, or repo-tasks.",
          },
        ];
      }
      return [
        {
          id: "retract",
          moduleName: MODULE_NAME,
          status: "ready",
          message: `Retract seam over ${sources.length} contributor(s).`,
          meta: { contributorCount: sources.length, sources: sources.join(",") },
        },
      ];
    },
  };
}
