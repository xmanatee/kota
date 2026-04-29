import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { HistoryProvider } from "#core/modules/provider-types.js";

const MODULE_NAME = "history";

export function createHistoryReadinessSource(
  provider: HistoryProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const reports: CapabilityReadiness[] = [
        {
          id: "history.search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Keyword/listing search over conversation history.",
        },
      ];
      if (provider.supportsSemanticSearch()) {
        reports.push({
          id: "history.semantic_search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Embedding-backed semantic search over past conversations.",
        });
      } else {
        reports.push({
          id: "history.semantic_search",
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "embedding_unsupported",
          message:
            "Semantic search is unavailable — load `history-semantic` and configure an embedding provider.",
        });
      }
      return reports;
    },
  };
}
