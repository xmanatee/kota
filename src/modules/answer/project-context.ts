import { join } from "node:path";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
  type ProjectId,
} from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  type AnswerHistoryStore,
  answerHistoryRootForProject,
  DiskAnswerHistoryStore,
} from "./answer-history-store.js";
import type { AnswerProjectContext } from "./answer-types.js";

type ProjectScopeSnapshot = {
  defaultProjectId: ProjectId;
  activeProjectId: ProjectId | null;
  projects: readonly ConfiguredProject[];
};

export type ResolveAnswerProjectContext = (
  projectId: string | null | undefined,
) => AnswerProjectContext | { error: "unknown_project"; projectId: string };

export function createAnswerProjectContextResolver(
  defaultProjectDir: string,
  getDefaultHistory?: () => AnswerHistoryStore | null,
): ResolveAnswerProjectContext {
  const fallbackProject = buildConfiguredProject({ projectDir: defaultProjectDir });
  const stores = new Map<ProjectId, AnswerHistoryStore>();

  function snapshot(): ProjectScopeSnapshot {
    const daemonScope = getProviderRegistry()?.get(
      DAEMON_PROJECT_SCOPE_PROVIDER_TYPE,
    );
    if (daemonScope) {
      const projection = daemonScope.getProjectRegistryProjection();
      return {
        defaultProjectId: projection.defaultProjectId,
        activeProjectId: daemonScope.getActiveProjectId(),
        projects: projection.projects,
      };
    }
    return {
      defaultProjectId: fallbackProject.projectId,
      activeProjectId: null,
      projects: [fallbackProject],
    };
  }

  function storeFor(
    project: ConfiguredProject,
    defaultProjectId: ProjectId,
  ): AnswerHistoryStore {
    if (project.projectId === defaultProjectId) {
      const defaultHistory = getDefaultHistory?.();
      if (defaultHistory) return defaultHistory;
    }
    const existing = stores.get(project.projectId);
    if (existing) return existing;
    const store = new DiskAnswerHistoryStore({
      rootDir: answerHistoryRootForProject(join(project.projectDir, ".kota")),
    });
    stores.set(project.projectId, store);
    return store;
  }

  return (projectId) => {
    const scope = snapshot();
    const requested = projectId?.trim();
    const resolvedProjectId =
      requested && requested.length > 0
        ? requested
        : scope.activeProjectId ?? scope.defaultProjectId;
    const project = scope.projects.find(
      (entry) => entry.projectId === resolvedProjectId,
    );
    if (!project) {
      return { error: "unknown_project", projectId: resolvedProjectId };
    }
    return {
      projectId: project.projectId,
      projectDir: project.projectDir,
      history: storeFor(project, scope.defaultProjectId),
    };
  };
}
