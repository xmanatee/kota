import { asArray, asObject, asOptionalString, asString, fail } from './decoder-common';

// MARK: - Project registry projection

export type ProjectRegistryEntry = {
  projectId: string;
  projectDir: string;
  displayName: string;
};

export type ProjectRegistryProjection = {
  defaultProjectId: string;
  projects: ProjectRegistryEntry[];
};

export function parseProjectRegistryProjection(
  raw: unknown,
): ProjectRegistryProjection {
  const obj = asObject(raw, "projects");
  const defaultProjectId = asString(
    obj.defaultProjectId,
    "projects.defaultProjectId",
  );
  const projectsRaw = asArray(obj.projects, "projects.projects");
  if (projectsRaw.length === 0) {
    fail("projects.projects must declare at least one entry");
  }
  const projects = projectsRaw.map((entry, index) => {
    const e = asObject(entry, `projects.projects[${index}]`);
    return {
      projectId: asString(e.projectId, `projects.projects[${index}].projectId`),
      projectDir: asString(
        e.projectDir,
        `projects.projects[${index}].projectDir`,
      ),
      displayName: asString(
        e.displayName,
        `projects.projects[${index}].displayName`,
      ),
    };
  });
  if (!projects.some((p) => p.projectId === defaultProjectId)) {
    fail(
      `projects.defaultProjectId ${defaultProjectId} does not match any registered project`,
    );
  }
  return { defaultProjectId, projects };
}

// MARK: - Scope registry projection

export type ScopeRegistryEntry = {
  scopeId: string;
  displayName: string;
  parentScopeId?: string;
  directoryRoot?: string;
};

export type ScopeRegistryProjection = {
  rootScopeId: string;
  defaultScopeId: string;
  scopes: ScopeRegistryEntry[];
};

export function parseScopeRegistryProjection(
  raw: unknown,
): ScopeRegistryProjection {
  const obj = asObject(raw, "scopes");
  const rootScopeId = asString(obj.rootScopeId, "scopes.rootScopeId");
  const defaultScopeId = asString(
    obj.defaultScopeId,
    "scopes.defaultScopeId",
  );
  const scopesRaw = asArray(obj.scopes, "scopes.scopes");
  if (scopesRaw.length === 0) {
    fail("scopes.scopes must declare at least one entry");
  }
  const scopes = scopesRaw.map((entry, index) => {
    const e = asObject(entry, `scopes.scopes[${index}]`);
    return {
      scopeId: asString(e.scopeId, `scopes.scopes[${index}].scopeId`),
      displayName: asString(
        e.displayName,
        `scopes.scopes[${index}].displayName`,
      ),
      parentScopeId: asOptionalString(
        e.parentScopeId,
        `scopes.scopes[${index}].parentScopeId`,
      ),
      directoryRoot: asOptionalString(
        e.directoryRoot,
        `scopes.scopes[${index}].directoryRoot`,
      ),
    };
  });
  if (!scopes.some((scope) => scope.scopeId === rootScopeId)) {
    fail(`scopes.rootScopeId ${rootScopeId} does not match any registered scope`);
  }
  if (!scopes.some((scope) => scope.scopeId === defaultScopeId)) {
    fail(
      `scopes.defaultScopeId ${defaultScopeId} does not match any registered scope`,
    );
  }
  return { rootScopeId, defaultScopeId, scopes };
}

export type UnknownProjectError = {
  error: "Unknown project";
  reason: "unknown_project";
  projectId: string;
};

export function parseUnknownProjectError(raw: unknown): UnknownProjectError {
  const obj = asObject(raw, "unknownProjectError");
  const error = asString(obj.error, "unknownProjectError.error");
  if (error !== "Unknown project") {
    fail(`unknownProjectError.error must be "Unknown project", got ${error}`);
  }
  const reason = asString(obj.reason, "unknownProjectError.reason");
  if (reason !== "unknown_project") {
    fail(
      `unknownProjectError.reason must be "unknown_project", got ${reason}`,
    );
  }
  return {
    error,
    reason,
    projectId: asString(obj.projectId, "unknownProjectError.projectId"),
  };
}
