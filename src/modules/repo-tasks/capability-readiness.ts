import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";

const MODULE_NAME = "repo-tasks";

export function createRepoTasksReadinessSource(
  resolveProvider: () => RepoTasksProvider,
): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    probe(): CapabilityReadiness[] {
      const reports: CapabilityReadiness[] = [
        {
          id: "repo-tasks.search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Keyword/substring search over the repo task queue.",
        },
      ];
      const provider = resolveProvider();
      if (provider.supportsSemanticSearch()) {
        reports.push({
          id: "repo-tasks.semantic_search",
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Embedding-backed semantic search over the repo task queue.",
        });
      } else {
        reports.push({
          id: "repo-tasks.semantic_search",
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "embedding_unsupported",
          message:
            "Semantic task search is unavailable — load `tasks-semantic` and configure an embedding provider.",
        });
      }
      return reports;
    },
  };
}
