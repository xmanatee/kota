import {
  buildConfiguredProject,
  type ConfiguredProject,
  type ProjectId,
} from "#core/daemon/project-registry.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { HistoryProvider } from "#core/modules/provider-types.js";
import { getProjectHistoryStore } from "./history.js";

export type UnknownHistoryProjectError = {
  error: "Unknown project";
  reason: "unknown_project";
  projectId: string;
};

type ProjectScopeSnapshot = {
  defaultProjectId: ProjectId;
  activeProjectId: ProjectId | null;
  projects: readonly ConfiguredProject[];
};

export type HistoryProjectStoresOptions = {
  defaultProjectDir: string;
  projects?: readonly ConfiguredProject[];
  defaultProjectId?: ProjectId;
  getActiveProjectId?: () => ProjectId | null;
  getDefaultProvider?: () => HistoryProvider | null;
};

export class HistoryProjectStores {
  private readonly fallbackProject: ConfiguredProject;
  private readonly fallbackProjects: readonly ConfiguredProject[];
  private readonly fallbackDefaultProjectId: ProjectId;
  private readonly getFallbackActiveProjectId: () => ProjectId | null;
  private readonly getDefaultProvider: (() => HistoryProvider | null) | undefined;
  private readonly stores = new Map<ProjectId, HistoryProvider>();

  constructor(options: HistoryProjectStoresOptions) {
    this.fallbackProject = buildConfiguredProject({
      projectDir: options.defaultProjectDir,
    });
    this.fallbackProjects = options.projects ?? [this.fallbackProject];
    const firstProject = this.fallbackProjects[0];
    if (!firstProject) {
      throw new Error("HistoryProjectStores requires at least one project");
    }
    this.fallbackDefaultProjectId =
      options.defaultProjectId ?? firstProject.projectId;
    if (
      !this.fallbackProjects.some(
        (project) => project.projectId === this.fallbackDefaultProjectId,
      )
    ) {
      throw new Error(
        `HistoryProjectStores default project ${this.fallbackDefaultProjectId} is not registered`,
      );
    }
    this.getFallbackActiveProjectId = options.getActiveProjectId ?? (() => null);
    this.getDefaultProvider = options.getDefaultProvider;
  }

  resolve(
    projectId: string | null | undefined,
  ):
    | { ok: true; projectId: ProjectId; store: HistoryProvider }
    | { ok: false; error: UnknownHistoryProjectError } {
    const snapshot = this.snapshot();
    const requested = projectId?.trim();
    const resolvedProjectId =
      requested && requested.length > 0
        ? requested
        : snapshot.activeProjectId ?? snapshot.defaultProjectId;
    const project = snapshot.projects.find(
      (entry) => entry.projectId === resolvedProjectId,
    );
    if (!project) {
      return {
        ok: false,
        error: {
          error: "Unknown project",
          reason: "unknown_project",
          projectId: resolvedProjectId,
        },
      };
    }
    return {
      ok: true,
      projectId: project.projectId,
      store: this.storeFor(project, snapshot.defaultProjectId),
    };
  }

  private snapshot(): ProjectScopeSnapshot {
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
      defaultProjectId: this.fallbackDefaultProjectId,
      activeProjectId: this.getFallbackActiveProjectId(),
      projects: this.fallbackProjects,
    };
  }

  private storeFor(
    project: ConfiguredProject,
    defaultProjectId: ProjectId,
  ): HistoryProvider {
    if (project.projectId === defaultProjectId) {
      const provider = this.getDefaultProvider?.();
      if (provider) return provider;
    }
    const existing = this.stores.get(project.projectId);
    if (existing) return existing;
    const store = getProjectHistoryStore(project.projectDir);
    this.stores.set(project.projectId, store);
    return store;
  }
}

export function createHistoryProjectStores(
  defaultProjectDir: string,
  getDefaultProvider?: () => HistoryProvider | null,
): HistoryProjectStores {
  return new HistoryProjectStores({ defaultProjectDir, getDefaultProvider });
}
