import {
  getHistoryProvider,
  type HistoryProjectProvider,
} from "#core/modules/provider-registry.js";
import type { HistoryProvider } from "#core/modules/provider-types.js";
import type { ProjectRuntimeRegistry } from "./project-runtime.js";

export function createChatHistoryProviderResolver(options: {
  projectRuntimes: ProjectRuntimeRegistry;
  historyProjectProvider: HistoryProjectProvider | null | undefined;
}): (projectId: string) => HistoryProvider {
  return (projectId) => {
    const runtime = options.projectRuntimes.get(projectId);
    const isDefault =
      runtime.project.projectId === options.projectRuntimes.getDefaultProjectId();
    if (options.historyProjectProvider) {
      return options.historyProjectProvider.forProject({
        projectId: runtime.project.projectId,
        projectDir: runtime.project.projectDir,
        isDefault,
      });
    }
    if (isDefault) return getHistoryProvider();
    throw new Error(
      `Project-scoped history provider is not registered for project ${runtime.project.projectId}`,
    );
  };
}
