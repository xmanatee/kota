import { JsonFileError, writeJsonFileAtomic } from "#core/util/json-file.js";
import {
  resolveDirectoryScopeRoot,
  resolveLiveDirectoryScope,
} from "./scope-directory.js";
import {
  type ConfiguredProject,
  type ConfiguredProjectInput,
  loadRegistryFileFromDisk,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  type ProjectId,
  type ProjectRegistryFile,
  type ProjectRegistryProjection,
  type ScopeId,
  type ScopeRegistryInit,
  type ScopeRegistryProjection,
  scopeRegistryPath,
} from "./scope-registry.js";
import { scopeProjectionFromProjects } from "./scope-registry-projection.js";

/** Persisted, atomically mutable authority for directory-backed daemon scopes. */
export class ScopeRegistry {
  private readonly stateDir: string;
  private byId = new Map<ProjectId, ConfiguredProject>();
  private byDir = new Map<string, ConfiguredProject>();
  private orderedIds: ProjectId[] = [];
  private defaultProjectId: ProjectId;

  constructor(init: ScopeRegistryInit) {
    this.stateDir = init.stateDir;
    const persisted = loadRegistryFileFromDisk(init.stateDir);
    if (persisted !== null) {
      const path = scopeRegistryPath(init.stateDir);
      const projects = persisted.projects.map((project, index) =>
        restorePersistedProject(path, project, index),
      );
      assertUniqueProjects(projects);
      this.defaultProjectId = persisted.defaultProjectId;
      this.installState(projects, persisted.defaultProjectId);
      return;
    }
    if (init.projects.length === 0) {
      throw new Error("ScopeRegistry requires at least one project");
    }
    const projects = init.projects.map((input, index) =>
      requireLiveProject(input, `projects[${index}]`),
    );
    assertUniqueProjects(projects);
    const defaultProjectId = projects[0]?.projectId;
    if (defaultProjectId === undefined) throw new Error("ScopeRegistry resolved zero projects");
    this.defaultProjectId = defaultProjectId;
    this.installState(projects, defaultProjectId);
    this.persistState(projects, defaultProjectId);
  }

  list(): readonly ConfiguredProject[] {
    return this.orderedIds.map((id) => {
      const project = this.byId.get(id);
      if (!project) throw new Error(`ScopeRegistry: missing entry for ${id}`);
      return project;
    });
  }

  get(projectId: ProjectId): ConfiguredProject | undefined {
    return this.byId.get(projectId);
  }

  getByDir(projectDir: string): ConfiguredProject | undefined {
    resolveDirectoryScopeRoot(projectDir);
    const resolved = resolveLiveDirectoryScope({ projectDir });
    return resolved.ok ? this.byDir.get(resolved.project.projectDir) : undefined;
  }

  getDefault(): ConfiguredProject {
    const project = this.byId.get(this.defaultProjectId);
    if (!project) {
      throw new Error(`ScopeRegistry: defaultProjectId ${this.defaultProjectId} is missing`);
    }
    return project;
  }

  getDefaultProjectId(): ProjectId {
    return this.defaultProjectId;
  }

  getDefaultScopeId(): ScopeId {
    return this.defaultProjectId;
  }

  add(project: ConfiguredProject): void {
    if (this.byId.has(project.projectId) || this.byDir.has(project.projectDir)) {
      throw new Error(`ScopeRegistry: scope ${project.projectId} is already registered`);
    }
    this.commitState([...this.list(), project], this.defaultProjectId);
  }

  updateDisplayName(scopeId: ScopeId, displayNameInput: string): ConfiguredProject {
    const current = this.byId.get(scopeId);
    if (!current) throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    const displayName = displayNameInput.trim();
    if (!displayName) throw new Error("displayName must be a non-empty string");
    const updated = { ...current, displayName };
    this.commitState(
      this.list().map((project) => project.projectId === scopeId ? updated : project),
      this.defaultProjectId,
    );
    return updated;
  }

  setDefault(scopeId: ScopeId): void {
    if (!this.byId.has(scopeId)) {
      throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    }
    this.commitState(this.list(), scopeId);
  }

  remove(scopeId: ScopeId): ConfiguredProject {
    const current = this.byId.get(scopeId);
    if (!current) throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    if (scopeId === this.defaultProjectId) {
      throw new Error("ScopeRegistry: the default scope cannot be removed");
    }
    this.commitState(
      this.list().filter((project) => project.projectId !== scopeId),
      this.defaultProjectId,
    );
    return current;
  }

  toProjection(): ProjectRegistryProjection {
    return {
      defaultProjectId: this.defaultProjectId,
      projects: this.list().map((project) => ({ ...project })),
    };
  }

  toScopeProjection(): ScopeRegistryProjection {
    return scopeProjectionFromProjects(this.defaultProjectId, this.list());
  }

  private commitState(projects: readonly ConfiguredProject[], defaultId: ProjectId): void {
    this.persistState(projects, defaultId);
    this.installState(projects, defaultId);
  }

  private installState(projects: readonly ConfiguredProject[], defaultId: ProjectId): void {
    if (!projects.some((project) => project.projectId === defaultId)) {
      throw new Error(`ScopeRegistry: default scope ${defaultId} is not registered`);
    }
    this.byId = new Map(projects.map((project) => [project.projectId, project]));
    this.byDir = new Map(projects.map((project) => [project.projectDir, project]));
    this.orderedIds = projects.map((project) => project.projectId);
    this.defaultProjectId = defaultId;
  }

  private persistState(projects: readonly ConfiguredProject[], defaultId: ProjectId): void {
    writeJsonFileAtomic(scopeRegistryPath(this.stateDir), {
      schema: PROJECT_REGISTRY_SCHEMA_VERSION,
      defaultProjectId: defaultId,
      projects: projects.map((project) => ({ ...project })),
    } satisfies ProjectRegistryFile);
  }
}

function restorePersistedProject(
  path: string,
  stored: ConfiguredProject,
  index: number,
): ConfiguredProject {
  const resolved = resolveLiveDirectoryScope(stored);
  if (!resolved.ok) {
    throw new JsonFileError(path, "parse", `projects[${index}] cannot be restored: ${resolved.reason}`);
  }
  if (resolved.project.projectId !== stored.projectId) {
    throw new JsonFileError(
      path,
      "parse",
      `projects[${index}].projectId does not match its canonical directory root`,
    );
  }
  return { ...resolved.project, displayName: stored.displayName };
}

function requireLiveProject(input: ConfiguredProjectInput, field: string): ConfiguredProject {
  const result = resolveLiveDirectoryScope(input);
  if (result.ok) return result.project;
  throw new Error(`${field}: ${result.message}`);
}

function assertUniqueProjects(projects: readonly ConfiguredProject[]): void {
  const seenIds = new Set<ProjectId>();
  const seenDirs = new Set<string>();
  for (const project of projects) {
    if (seenIds.has(project.projectId) || seenDirs.has(project.projectDir)) {
      throw new Error(
        `ScopeRegistry: duplicate projectDir resolved to ${project.projectId} (${project.projectDir})`,
      );
    }
    seenIds.add(project.projectId);
    seenDirs.add(project.projectDir);
  }
}
