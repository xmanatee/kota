/**
 * Project registry — typed primitive that names every project a single
 * daemon process is configured to host.
 *
 * Today the daemon is single-project: every store, scheduler, queue, event,
 * and control-API handler binds to one `projectDir` consumed at construction.
 * The registry is the foundation for the multi-project runtime: it gives the
 * daemon (and clients through the control API) one authoritative answer to
 * "which projects am I configured for, what is each project's stable id, and
 * which one is the default for single-project operators."
 *
 * Wiring the registry through every daemon-owned subsystem and adding a
 * `projectId` scope to events / API routes / decoders is intentionally NOT
 * part of this file. Those slices ship as follow-up tasks; this file only
 * owns the primitive's typed shape, deterministic id derivation, and
 * file-backed persistence so later slices have something to attach to.
 */

import { join, resolve } from "node:path";
import type { ProjectId } from "#core/events/project-scope.js";
import {
  JsonFileError,
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import { projectHash } from "./schedule-parser.js";

/**
 * Stable opaque project identity. The type alias lives in
 * `#core/events/project-scope.js` so foundational subsystems can scope
 * events without depending on the daemon tree; this module owns the
 * deterministic runtime derivation ({@link deriveProjectId}) and the
 * file-backed registry that persists configured projects.
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
export function deriveProjectId(projectDir: string): ProjectId {
  return projectHash(resolve(projectDir));
}

/**
 * Resolve one operator-supplied input into a {@link ConfiguredProject},
 * normalizing the path and filling a default display name.
 */
export function buildConfiguredProject(
  input: ConfiguredProjectInput,
): ConfiguredProject {
  const projectDir = resolve(input.projectDir);
  const displayName = (input.displayName ?? "").trim() || basename(projectDir);
  return {
    projectId: deriveProjectId(projectDir),
    projectDir,
    displayName,
  };
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

export type ProjectRegistryInit = {
  /** Daemon state directory. The registry file is written under this dir. */
  stateDir: string;
  /** One or more configured projects. The first entry is the default. */
  projects: readonly ConfiguredProjectInput[];
};

/**
 * In-memory project registry, persisted to `<stateDir>/project-registry.json`.
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
 * Mutators (add/remove/setDefault) are intentionally not on the surface
 * yet. The first slice only covers the typed shape and the configured
 * projection used by every other slice; runtime registration arrives with
 * the per-project ProjectRuntime bundle.
 */
export class ProjectRegistry {
  private readonly stateDir: string;
  private readonly byId: Map<ProjectId, ConfiguredProject>;
  private readonly byDir: Map<string, ConfiguredProject>;
  private readonly orderedIds: ProjectId[];
  private readonly defaultProjectId: ProjectId;

  constructor(init: ProjectRegistryInit) {
    if (init.projects.length === 0) {
      throw new Error("ProjectRegistry requires at least one project");
    }
    const resolved = init.projects.map(buildConfiguredProject);
    const seen = new Set<ProjectId>();
    for (const project of resolved) {
      if (seen.has(project.projectId)) {
        throw new Error(
          `ProjectRegistry: duplicate projectDir resolved to projectId ${project.projectId} (${project.projectDir})`,
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
      throw new Error("ProjectRegistry resolved zero projects");
    }
    this.defaultProjectId = firstId;
    this.persist();
  }

  /** All configured projects, in the order they were declared. */
  list(): readonly ConfiguredProject[] {
    return this.orderedIds.map((id) => {
      const project = this.byId.get(id);
      if (!project) {
        throw new Error(`ProjectRegistry: missing entry for ${id}`);
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
    return this.byDir.get(resolve(projectDir));
  }

  /** The project the daemon picks when an operation does not name one. */
  getDefault(): ConfiguredProject {
    const project = this.byId.get(this.defaultProjectId);
    if (!project) {
      throw new Error(
        `ProjectRegistry: defaultProjectId ${this.defaultProjectId} missing from byId map`,
      );
    }
    return project;
  }

  /** Stable id of the default project. */
  getDefaultProjectId(): ProjectId {
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

/**
 * Resolve `DaemonConfig`'s project-shape inputs into the canonical list the
 * {@link ProjectRegistry} consumes.
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
    return opts.projects;
  }
  return [{ projectDir: opts.projectDir ?? opts.fallbackProjectDir }];
}
