import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";

const MODULE_NAME = "knowledge";

export function createKnowledgeReadinessSource(
  provider: KnowledgeProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const reports: CapabilityReadiness[] = [
        {
          id: "knowledge.search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Keyword search over the knowledge store.",
        },
      ];
      if (provider.supportsSemanticSearch()) {
        reports.push({
          id: "knowledge.semantic_search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Embedding-backed semantic search over knowledge entries.",
        });
      } else {
        reports.push({
          id: "knowledge.semantic_search",
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "embedding_unsupported",
          message:
            "Semantic search is unavailable — load `knowledge-semantic` and configure an embedding provider.",
        });
      }
      return reports;
    },
  };
}
