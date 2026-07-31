import { buildUiSurfaceBundle, type UiSurface, type UiSurfaceBundle } from "#core/daemon/ui-surface.js";
import type { KotaClient } from "#core/server/kota-client.js";
import {
  type NormalizedScopeSelector,
  normalizeScopeSelector,
  type ScopeSelector,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";

const UI_SURFACE_SOURCE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export type UiSurfaceRead<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type UiSurfaceProjectionContext = {
  cwd: string;
  scopeId: string;
  selector: NormalizedScopeSelector;
  client: KotaClient;
  read<T>(label: string, loader: () => Promise<T>): Promise<UiSurfaceRead<T>>;
};

/**
 * A side-effect-free module declaration whose projector performs live reads
 * only when a client asks for the shared UI graph.
 */
export type UiSurfaceSource = {
  sourceId: string;
  project(
    context: UiSurfaceProjectionContext,
  ): readonly UiSurface[] | Promise<readonly UiSurface[]>;
};

export type UiSurfaceProjectionRequest = {
  client: KotaClient;
  selector?: ScopeSelector;
};

export type RegisteredUiSurfaceSource = {
  moduleName: string;
  source: UiSurfaceSource;
};

export class UiSurfaceSourceError extends Error {
  readonly moduleName: string;
  readonly sourceId: string;

  constructor(moduleName: string, sourceId: string, cause: Error) {
    super(
      `UI surface source "${sourceId}" from module "${moduleName}" failed: ${cause.message}`,
      { cause },
    );
    this.name = "UiSurfaceSourceError";
    this.moduleName = moduleName;
    this.sourceId = sourceId;
  }
}

export function validateUiSurfaceSourceRegistrations(
  registrations: readonly RegisteredUiSurfaceSource[],
): void {
  const owners = new Map<string, string>();
  for (const { moduleName, source } of registrations) {
    if (!UI_SURFACE_SOURCE_ID_PATTERN.test(source.sourceId)) {
      throw new Error(
        `Module "${moduleName}" UI surface source id ${JSON.stringify(source.sourceId)} must match ${UI_SURFACE_SOURCE_ID_PATTERN.source}`,
      );
    }
    const owner = owners.get(source.sourceId);
    if (owner) {
      throw new Error(
        `Duplicate UI surface source id "${source.sourceId}" from modules "${owner}" and "${moduleName}"`,
      );
    }
    owners.set(source.sourceId, moduleName);
  }
}

async function resolveProjectionContext(
  cwd: string,
  request: UiSurfaceProjectionRequest,
): Promise<UiSurfaceProjectionContext> {
  let selector = normalizeScopeSelector(request.selector);
  const selectedId = selectedScopeSelectorId(selector);
  let client = request.client;
  let scopeId = selectedId;

  if (selectedId !== undefined) {
    client = scopeProjectionClient(request.client, selector, selectedId);
  } else {
    const projects = await request.client.projects.list();
    if (projects.ok) {
      scopeId = projects.activeProjectId ?? projects.defaultProjectId;
      selector = { scopeId };
      client = scopeProjectionClient(request.client, selector, scopeId);
    }
  }

  return {
    cwd,
    scopeId: scopeId ?? `dir:${cwd}`,
    selector,
    client,
    read: async <T>(label: string, loader: () => Promise<T>): Promise<UiSurfaceRead<T>> => {
      try {
        return { ok: true, value: await loader() };
      } catch (error) {
        return {
          ok: false,
          message: `${label}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

function scopeProjectionClient(
  client: KotaClient,
  selector: NormalizedScopeSelector,
  selectedId: string,
): KotaClient {
  return selector.scopeId !== undefined && client.forScope
    ? client.forScope(selectedId)
    : client.forProject(selectedId);
}

/** Project every loaded module source once, then validate and order one bundle. */
export async function assembleUiSurfaceBundle(
  cwd: string,
  registrations: readonly RegisteredUiSurfaceSource[],
  request: UiSurfaceProjectionRequest,
): Promise<UiSurfaceBundle> {
  validateUiSurfaceSourceRegistrations(registrations);
  const context = await resolveProjectionContext(cwd, request);
  const projections = await Promise.all(registrations.map(async ({ moduleName, source }) => {
    try {
      return await source.project(context);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new UiSurfaceSourceError(moduleName, source.sourceId, cause);
    }
  }));
  return buildUiSurfaceBundle(projections.flat());
}
