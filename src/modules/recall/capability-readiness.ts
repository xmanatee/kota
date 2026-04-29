import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { RecallProvider } from "./recall-types.js";

const MODULE_NAME = "recall";

export function createRecallReadinessSource(
  provider: RecallProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const sources = provider.contributors();
      if (sources.length === 0) {
        return [
          {
            id: "recall",
            moduleName: MODULE_NAME,
            status: "unavailable",
            reason: "no_contributors",
            message:
              "Recall has no registered contributors — load knowledge, memory, history, or repo-tasks.",
          },
        ];
      }
      return [
        {
          id: "recall",
          moduleName: MODULE_NAME,
          status: "ready",
          message: `Cross-store recall over ${sources.length} contributor(s).`,
          meta: { contributorCount: sources.length, sources: sources.join(",") },
        },
      ];
    },
  };
}
