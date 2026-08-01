import type {
  ConfiguredProject,
  ConfiguredProjectInput,
  ScopeId,
  ScopeRegistryProjection,
} from "./scope-registry.js";

export const GLOBAL_SCOPE_ID = "global";

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
