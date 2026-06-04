/**
 * Scope registry — typed primitive that names the daemon-hosted runtime
 * contexts KOTA can reason about.
 *
 * Directory-backed scopes are the first concrete provider. The control API
 * exposes the canonical `/scopes` projection; project-named routes and ids are
 * compatibility language for directory-backed scopes. This file owns the
 * registry shape, deterministic directory-scope id derivation, root-scope
 * projection, and existing file-backed registry persistence.
 */

import { join, resolve } from "node:path";
import type { ProjectId } from "#core/events/project-scope.js";
import {
  JsonFileError,
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import { projectHash } from "./schedule-parser.js";

export const GLOBAL_SCOPE_ID = "global";

export type ScopeId = ProjectId;

/**
 * Stable opaque directory-scope identity. The compatibility alias lives in
 * `#core/events/project-scope.js` so foundational subsystems can scope
 * events without depending on the daemon tree; this module owns the
 * deterministic runtime derivation ({@link deriveDirectoryScopeId}) and the
 * file-backed registry that persists configured directory scopes.
 */
export type { ProjectId };

/**
 * Operator-supplied input for one configured project.
 *
 * Keep this shape minimal and explicit: the projectId is *not* an input —
 * it is derived from the resolved `projectDir` so a hand-edited config file
 * cannot drift away from the on-disk identity the rest of the daemon will
 * use to scope state.
 */
export type ConfiguredProjectInput = {
  /** Absolute or relative path to the project root. Will be resolved. */
  projectDir: string;
  /** Optional human-facing label. Defaults to `basename(projectDir)`. */
  displayName?: string;
};

/**
 * One fully-resolved project entry held by the registry.
 */
export type ConfiguredProject = {
  readonly projectId: ProjectId;
  /** Resolved absolute path. */
  readonly projectDir: string;
  /** Operator-facing label, never empty. */
  readonly displayName: string;
};

/**
 * Canonical scope projection entry. The global root has no parent or directory
 * root; directory-backed scopes use the deterministic directory id as their
 * scope id.
 */
export type ConfiguredScope = {
  readonly scopeId: ScopeId;
  readonly displayName: string;
  readonly parentScopeId?: ScopeId;
  readonly directoryRoot?: string;
};

export type ScopeRegistryProjection = {
  readonly rootScopeId: ScopeId;
  readonly defaultScopeId: ScopeId;
  readonly scopes: ConfiguredScope[];
};

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_FILE = "project-registry.json";

type ProjectRegistryFile = {
  schema: typeof REGISTRY_SCHEMA_VERSION;
  defaultProjectId: ProjectId;
  projects: ConfiguredProject[];
};

/**
 * Derive the stable {@link ProjectId} for a given resolved project root.
 *
 * Uses the same deterministic hash already used to scope per-project files
 * (`tasks-<hash>.json`, `schedules-<hash>.json`) so the registry id matches
 * any existing per-project storage rather than introducing a parallel
 * identifier.
 */
export function deriveDirectoryScopeId(projectDir: string): ProjectId {
  return projectHash(resolveDirectoryScopeRoot(projectDir));
}

/**
 * Resolve one operator-supplied input into a {@link ConfiguredProject},
 * normalizing the path and filling a default display name.
 */
export function buildConfiguredProject(
  input: ConfiguredProjectInput,
): ConfiguredProject {
  const projectDir = resolveDirectoryScopeRoot(input.projectDir);
  const displayName = (input.displayName ?? "").trim() || basename(projectDir);
  return {
    projectId: deriveDirectoryScopeId(projectDir),
    projectDir,
    displayName,
  };
}

function resolveDirectoryScopeRoot(projectDir: string): string {
  if (!projectDir.trim()) {
    throw new Error("projectDir must be a non-empty string");
  }
  return resolve(projectDir);
}

function basename(path: string): string {
  const sep = path.lastIndexOf("/");
  if (sep < 0) return path;
  const tail = path.slice(sep + 1);
  return tail || path;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConfiguredProject(
  path: string,
  index: number,
  raw: unknown,
): ConfiguredProject {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(
      path,
      "parse",
      `projects[${index}] is not an object`,
    );
  }
  const projectId = raw.projectId;
  const projectDir = raw.projectDir;
  const displayName = raw.displayName;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new JsonFileError(
      path,
      "parse",
      `projects[${index}].projectId must be a non-empty string`,
    );
  }
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new JsonFileError(
      path,
      "parse",
      `projects[${index}].projectDir must be a non-empty string`,
    );
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    throw new JsonFileError(
      path,
      "parse",
      `projects[${index}].displayName must be a non-empty string`,
    );
  }
  return { projectId, projectDir, displayName };
}

function assertRegistryFile(
  path: string,
  raw: unknown,
): ProjectRegistryFile {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(path, "parse", "registry file is not an object");
  }
  if (raw.schema !== REGISTRY_SCHEMA_VERSION) {
    throw new JsonFileError(
      path,
      "parse",
      `unsupported registry schema: ${String(raw.schema)}`,
    );
  }
  const projectsRaw = raw.projects;
  if (!Array.isArray(projectsRaw)) {
    throw new JsonFileError(path, "parse", "projects must be an array");
  }
  const projects = projectsRaw.map((entry, index) =>
    assertConfiguredProject(path, index, entry),
  );
  if (projects.length === 0) {
    throw new JsonFileError(path, "parse", "registry must declare at least one project");
  }
  const defaultProjectId = raw.defaultProjectId;
  if (typeof defaultProjectId !== "string" || !defaultProjectId.trim()) {
    throw new JsonFileError(
      path,
      "parse",
      "defaultProjectId must be a non-empty string",
    );
  }
  if (!projects.some((p) => p.projectId === defaultProjectId)) {
    throw new JsonFileError(
      path,
      "parse",
      `defaultProjectId ${defaultProjectId} does not match any registered project`,
    );
  }
  return { schema: REGISTRY_SCHEMA_VERSION, defaultProjectId, projects };
}

export type ScopeRegistryInit = {
  /** Daemon state directory. The registry file is written under this dir. */
  stateDir: string;
  /** One or more configured projects. The first entry is the default. */
  projects: readonly ConfiguredProjectInput[];
};

/**
 * In-memory scope registry, persisted to the existing
 * `<stateDir>/project-registry.json` store.
 *
 * The registry is constructed from operator config (`DaemonConfig.projects`
 * or the legacy single-project `DaemonConfig.projectDir`). Construction
 * resolves every input, derives stable {@link ProjectId} values, picks the
 * first input as the default, and writes the merged shape to disk so a
 * later daemon restart can compare/reload deterministically.
 *
 * If a registry file already exists on disk, the new in-memory registry is
 * still authoritative; the file is overwritten with the merged shape. This
 * matches how `daemon-state.json` already behaves: the running daemon owns
 * the live state, and the file is a checkpoint.
 *
 * Mutators (add/remove/setDefault) are intentionally not on the surface yet.
 * Control routes expose both the canonical scope projection and the
 * project-named compatibility projection from this registry.
 */
export class ScopeRegistry {
  private readonly stateDir: string;
  private readonly byId: Map<ProjectId, ConfiguredProject>;
  private readonly byDir: Map<string, ConfiguredProject>;
  private readonly orderedIds: ProjectId[];
  private readonly defaultProjectId: ProjectId;

  constructor(init: ScopeRegistryInit) {
    if (init.projects.length === 0) {
      throw new Error("ScopeRegistry requires at least one project");
    }
    const resolved = init.projects.map(buildConfiguredProject);
    const seen = new Set<ProjectId>();
    for (const project of resolved) {
      if (seen.has(project.projectId)) {
        throw new Error(
          `ScopeRegistry: duplicate projectDir resolved to projectId ${project.projectId} (${project.projectDir})`,
        );
      }
      seen.add(project.projectId);
    }
    this.stateDir = init.stateDir;
    this.byId = new Map(resolved.map((p) => [p.projectId, p]));
    this.byDir = new Map(resolved.map((p) => [p.projectDir, p]));
    this.orderedIds = resolved.map((p) => p.projectId);
    const firstId = resolved[0]?.projectId;
    if (firstId === undefined) {
      throw new Error("ScopeRegistry resolved zero projects");
    }
    this.defaultProjectId = firstId;
    this.persist();
  }

  /** All configured projects, in the order they were declared. */
  list(): readonly ConfiguredProject[] {
    return this.orderedIds.map((id) => {
      const project = this.byId.get(id);
      if (!project) {
        throw new Error(`ScopeRegistry: missing entry for ${id}`);
      }
      return project;
    });
  }

  /** Look up a configured project by id. */
  get(projectId: ProjectId): ConfiguredProject | undefined {
    return this.byId.get(projectId);
  }

  /** Look up a configured project by resolved projectDir. */
  getByDir(projectDir: string): ConfiguredProject | undefined {
    return this.byDir.get(resolveDirectoryScopeRoot(projectDir));
  }

  /** The project the daemon picks when an operation does not name one. */
  getDefault(): ConfiguredProject {
    const project = this.byId.get(this.defaultProjectId);
    if (!project) {
      throw new Error(
        `ScopeRegistry: defaultProjectId ${this.defaultProjectId} missing from byId map`,
      );
    }
    return project;
  }

  /** Stable id of the default project. */
  getDefaultProjectId(): ProjectId {
    return this.defaultProjectId;
  }

  /** Stable id of the default directory-backed scope. */
  getDefaultScopeId(): ScopeId {
    return this.defaultProjectId;
  }

  /**
   * Operator-facing projection clients consume through the control API. Kept
   * deliberately small — adding fields to this shape is an explicit contract
   * change covered by `client-contract.test.ts`.
   */
  toProjection(): ProjectRegistryProjection {
    return {
      defaultProjectId: this.defaultProjectId,
      projects: this.list().map((p) => ({
        projectId: p.projectId,
        projectDir: p.projectDir,
        displayName: p.displayName,
      })),
    };
  }

  /**
   * Canonical scope projection exposed by `GET /scopes`.
   */
  toScopeProjection(): ScopeRegistryProjection {
    return scopeProjectionFromProjects(this.defaultProjectId, this.list());
  }

  private persist(): void {
    const file: ProjectRegistryFile = {
      schema: REGISTRY_SCHEMA_VERSION,
      defaultProjectId: this.defaultProjectId,
      projects: this.list().map((p) => ({ ...p })),
    };
    writeJsonFileAtomic(join(this.stateDir, REGISTRY_FILE), file);
  }
}

/**
 * Read a previously persisted registry file. Used by tools and tests that
 * inspect the on-disk shape without constructing a live registry instance.
 *
 * Returns `null` when the file does not exist; throws {@link JsonFileError}
 * when the file exists but is malformed.
 */
export function loadRegistryFileFromDisk(
  stateDir: string,
): ProjectRegistryFile | null {
  const path = join(stateDir, REGISTRY_FILE);
  const raw = readOptionalJsonFile<unknown>(path);
  if (raw === null) return null;
  return assertRegistryFile(path, raw);
}

/**
 * Stable typed projection of the registry suitable for the wire contract.
 *
 * Clients render selectors against this shape. The fields are deliberately
 * the same as {@link ConfiguredProject} so a future "scoped to one project"
 * variant of the projection can reuse the entry shape.
 */
export type ProjectRegistryProjection = {
  defaultProjectId: ProjectId;
  projects: ConfiguredProject[];
};

export function scopeProjectionFromProjects(
  defaultScopeId: ScopeId,
  projects: readonly ConfiguredProject[],
): ScopeRegistryProjection {
  return {
    rootScopeId: GLOBAL_SCOPE_ID,
    defaultScopeId,
    scopes: [
      { scopeId: GLOBAL_SCOPE_ID, displayName: "Global" },
      ...projects.map((project) => ({
        scopeId: project.projectId,
        displayName: project.displayName,
        parentScopeId: GLOBAL_SCOPE_ID,
        directoryRoot: project.projectDir,
      })),
    ],
  };
}

/**
 * Resolve `DaemonConfig`'s project-shape inputs into the canonical list the
 * {@link ScopeRegistry} consumes.
 *
 * Single-project operators set only `projectDir`. Multi-project operators
 * set `projects` (and may still set `projectDir`, in which case the array
 * is authoritative). When neither is set, falls back to the supplied default
 * (`process.cwd()` for the daemon constructor) so KOTA-on-itself still works
 * with no config.
 */
export function resolveConfiguredProjects(opts: {
  projects?: readonly ConfiguredProjectInput[];
  projectDir?: string;
  fallbackProjectDir: string;
}): readonly ConfiguredProjectInput[] {
  if (opts.projects && opts.projects.length > 0) {
    opts.projects.forEach((project, index) => {
      assertNonEmptyProjectDir(project.projectDir, `projects[${index}].projectDir`);
    });
    return opts.projects;
  }
  if (opts.projectDir !== undefined) {
    assertNonEmptyProjectDir(opts.projectDir, "projectDir");
    return [{ projectDir: opts.projectDir }];
  }
  assertNonEmptyProjectDir(opts.fallbackProjectDir, "fallbackProjectDir");
  return [{ projectDir: opts.fallbackProjectDir }];
}

function assertNonEmptyProjectDir(projectDir: string, field: string): void {
  if (!projectDir.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}
