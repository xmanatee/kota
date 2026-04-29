import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { MemoryProvider } from "#core/modules/provider-types.js";

const MODULE_NAME = "memory";

export function createMemoryReadinessSource(
  provider: MemoryProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const reports: CapabilityReadiness[] = [
        {
          id: "memory.search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Keyword search over persisted memory entries.",
        },
      ];
      if (provider.supportsSemanticSearch()) {
        reports.push({
          id: "memory.semantic_search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Embedding-backed semantic search over memory entries.",
        });
      } else {
        reports.push({
          id: "memory.semantic_search",
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "embedding_unsupported",
          message:
            "Semantic search is unavailable — load `memory-semantic` and configure an embedding provider.",
        });
      }
      return reports;
    },
  };
}
