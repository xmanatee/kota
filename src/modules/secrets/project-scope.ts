import {
  getProjectSecretStore,
  type SecretStore,
} from "#core/config/secrets.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import {
  buildConfiguredProject,
  type ConfiguredProject,
  type ProjectId,
} from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  normalizeScopeSelectorArgument,
  type ScopeSelectorArgument,
  type UnknownScopeSelectorBody,
  unknownScopeSelectorBody,
} from "#core/server/scope-selector.js";

export type SecretProjectStoresOptions = {
  defaultProjectDir: string;
  projects?: readonly ConfiguredProject[];
  defaultProjectId?: ProjectId;
  getActiveProjectId?: () => ProjectId | null;
};

export type ResolvedSecretProjectStore = {
  projectId: ProjectId;
  projectDir: string;
  store: SecretStore;
};

export class SecretProjectStores {
  private readonly projects: readonly ConfiguredProject[];
  private readonly defaultProjectId: ProjectId;
  private readonly getActiveProjectId: () => ProjectId | null;

  constructor(options: SecretProjectStoresOptions) {
    const defaultProject = buildConfiguredProject({
      projectDir: options.defaultProjectDir,
    });
    this.projects = options.projects ?? [defaultProject];
    const firstProject = this.projects[0];
    if (!firstProject) {
      throw new Error("SecretProjectStores requires at least one project");
    }
    this.defaultProjectId = options.defaultProjectId ?? firstProject.projectId;
    if (!this.projects.some((project) => project.projectId === this.defaultProjectId)) {
      throw new Error(
        `SecretProjectStores default project ${this.defaultProjectId} is not registered`,
      );
    }
    this.getActiveProjectId = options.getActiveProjectId ?? (() => null);
  }

  resolve(
    selector?: ScopeSelectorArgument,
  ):
    | { ok: true; value: ResolvedSecretProjectStore }
    | { ok: false; error: UnknownScopeSelectorBody } {
    const normalized = normalizeScopeSelectorArgument(selector);
    const selectedId = normalized.scopeId ?? normalized.projectId;
    const daemonScope = getProviderRegistry()?.get(
      DAEMON_PROJECT_SCOPE_PROVIDER_TYPE,
    );
    if (daemonScope) {
      const resolved = daemonScope.resolveProjectRuntime(selectedId);
      if (!resolved.ok) {
        const unresolvedId = selectedId ?? resolved.error.projectId;
        return {
          ok: false,
          error: unknownScopeSelectorBody(normalized, unresolvedId),
        };
      }
      return {
        ok: true,
        value: {
          projectId: resolved.runtime.project.projectId,
          projectDir: resolved.runtime.project.projectDir,
          store: resolved.runtime.secretStore,
        },
      };
    }

    const projectId = selectedId
      ?? this.getActiveProjectId()
      ?? this.defaultProjectId;
    const project = this.projects.find((entry) => entry.projectId === projectId);
    if (!project) {
      return {
        ok: false,
        error: unknownScopeSelectorBody(normalized, projectId),
      };
    }
    return {
      ok: true,
      value: {
        projectId: project.projectId,
        projectDir: project.projectDir,
        store: getProjectSecretStore(project.projectDir),
      },
    };
  }
}

export function createSecretProjectStores(
  defaultProjectDir: string,
): SecretProjectStores {
  return new SecretProjectStores({ defaultProjectDir });
}

export function requireSecretStore(
  projectStores: SecretProjectStores,
  selector?: ScopeSelectorArgument,
): SecretStore {
  const resolved = projectStores.resolve(selector);
  if (resolved.ok) return resolved.value.store;
  if (resolved.error.reason === "unknown_scope") {
    throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  }
  throw new Error(`Unknown project: ${resolved.error.projectId}`);
}
