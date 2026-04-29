import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";

const MODULE_NAME = "answer";

export function createAnswerReadinessSource(opts: {
  hasModelClient: () => boolean;
}): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      if (!opts.hasModelClient()) {
        return [
          {
            id: "answer",
            moduleName: MODULE_NAME,
            status: "unavailable",
            reason: "missing_api_key",
            message:
              "Cited-answer synthesis is unavailable — configure a model provider/API key.",
          },
        ];
      }
      return [
        {
          id: "answer",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Cited-answer synthesis is ready.",
        },
      ];
    },
  };
}
