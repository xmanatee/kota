export type ScopeSelector = {
  scopeId?: string;
  projectId?: string;
};

export type ScopeSelectorArgument = string | ScopeSelector | undefined;

export type NormalizedScopeSelector = {
  scopeId?: string;
  projectId?: string;
};

export type ScopeSelectorConflictBody = {
  error: "Conflicting scope selectors";
  reason: "conflicting_scope_selectors";
  scopeId: string;
  projectId: string;
};

export type UnknownScopeSelectorBody =
  | {
      error: "Unknown scope";
      reason: "unknown_scope";
      scopeId: string;
    }
  | {
      error: "Unknown project";
      reason: "unknown_project";
      projectId: string;
    };

export type ScopeSelectorQueryNormalization =
  | { ok: true; changed: boolean; pathWithQuery: string }
  | { ok: false; status: 400; body: ScopeSelectorConflictBody };

export class ScopeSelectorConflictError extends Error {
  readonly reason = "conflicting_scope_selectors" as const;
  readonly scopeId: string;
  readonly projectId: string;

  constructor(scopeId: string, projectId: string) {
    super(`Conflicting scope selectors: scopeId=${scopeId}, projectId=${projectId}`);
    this.name = "ScopeSelectorConflictError";
    this.scopeId = scopeId;
    this.projectId = projectId;
  }
}

export function normalizeScopeSelector(
  selector?: ScopeSelector,
): NormalizedScopeSelector {
  const scopeId = normalizeSelectorValue(selector?.scopeId);
  const projectId = normalizeSelectorValue(selector?.projectId);
  if (scopeId !== undefined && projectId !== undefined && scopeId !== projectId) {
    throw new ScopeSelectorConflictError(scopeId, projectId);
  }
  return {
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

export function normalizeScopeSelectorArgument(
  selector?: ScopeSelectorArgument,
): NormalizedScopeSelector {
  if (typeof selector === "string") {
    return normalizeScopeSelector({ projectId: selector });
  }
  return normalizeScopeSelector(selector);
}

export function selectedScopeSelectorId(
  selector?: ScopeSelectorArgument,
): string | undefined {
  const normalized = normalizeScopeSelectorArgument(selector);
  return normalized.scopeId ?? normalized.projectId;
}

export function scopeSelectorFromUrl(url: URL): NormalizedScopeSelector {
  return normalizeScopeSelector({
    scopeId: url.searchParams.get("scopeId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
  });
}

export function appendScopeSelector(
  params: URLSearchParams,
  selector?: ScopeSelectorArgument,
): void {
  const normalized = normalizeScopeSelectorArgument(selector);
  if (normalized.scopeId !== undefined) params.set("scopeId", normalized.scopeId);
  if (normalized.projectId !== undefined) params.set("projectId", normalized.projectId);
}

export function scopeSelectorQuery(selector?: ScopeSelectorArgument): string {
  const params = new URLSearchParams();
  appendScopeSelector(params, selector);
  const query = encodeQueryParams(params);
  return query ? `?${query}` : "";
}

export function encodeQueryParams(params: URLSearchParams): string {
  return [...params]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function mergeScopeSelector<T extends ScopeSelector>(
  value: T | undefined,
  selector: ScopeSelector,
): T & ScopeSelector {
  const valueSelector = normalizeScopeSelector(value);
  const enforcedSelector = normalizeScopeSelector(selector);
  const valueId = valueSelector.scopeId ?? valueSelector.projectId;
  const enforcedId = enforcedSelector.scopeId ?? enforcedSelector.projectId;
  if (valueId !== undefined && enforcedId !== undefined && valueId !== enforcedId) {
    throw new ScopeSelectorConflictError(
      enforcedSelector.scopeId ?? valueSelector.scopeId ?? enforcedId,
      enforcedSelector.projectId ?? valueSelector.projectId ?? valueId,
    );
  }
  return {
    ...(value ?? ({} as T)),
    ...(enforcedSelector.scopeId !== undefined ? { scopeId: enforcedSelector.scopeId } : {}),
    ...(enforcedSelector.projectId !== undefined ? { projectId: enforcedSelector.projectId } : {}),
  };
}

export function scopeSelectorConflictBody(
  error: ScopeSelectorConflictError,
): ScopeSelectorConflictBody {
  return {
    error: "Conflicting scope selectors",
    reason: "conflicting_scope_selectors",
    scopeId: error.scopeId,
    projectId: error.projectId,
  };
}

export function unknownScopeSelectorBody(
  selector: ScopeSelectorArgument,
  selectedId: string,
): UnknownScopeSelectorBody {
  const normalized = normalizeScopeSelectorArgument(selector);
  if (normalized.scopeId !== undefined) {
    return {
      error: "Unknown scope",
      reason: "unknown_scope",
      scopeId: selectedId,
    };
  }
  return {
    error: "Unknown project",
    reason: "unknown_project",
    projectId: selectedId,
  };
}

export function normalizeScopeSelectorQueryUrl(
  url: URL,
): ScopeSelectorQueryNormalization {
  let selector: NormalizedScopeSelector;
  try {
    selector = scopeSelectorFromUrl(url);
  } catch (err) {
    if (!(err instanceof ScopeSelectorConflictError)) throw err;
    return { ok: false, status: 400, body: scopeSelectorConflictBody(err) };
  }
  if (selector.scopeId === undefined) {
    return {
      ok: true,
      changed: false,
      pathWithQuery: pathWithEncodedQuery(url),
    };
  }
  url.searchParams.set("projectId", selector.scopeId);
  return {
    ok: true,
    changed: true,
    pathWithQuery: pathWithEncodedQuery(url),
  };
}

export function normalizeScopeSelectorClientHandlers<T extends object>(
  handlers: T,
): T {
  const wrapped: Partial<T> = {};
  for (const key of Object.keys(handlers) as Array<keyof T>) {
    const namespace = handlers[key];
    wrapped[key] =
      typeof namespace === "object" && namespace !== null
        ? wrapScopeSelectorNamespace(namespace)
        : namespace;
  }
  return wrapped as T;
}

function wrapScopeSelectorNamespace<T extends object>(namespace: T): T {
  return new Proxy(namespace, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: never[]) =>
        Reflect.apply(
          value,
          target,
          args.map((arg) => normalizeScopeSelectorClientArgument(arg)),
        );
    },
  });
}

function normalizeScopeSelectorClientArgument<T>(value: T): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  if (!("scopeId" in value) && !("projectId" in value)) return value;
  const normalized = normalizeScopeSelector(value as ScopeSelector);
  if (normalized.scopeId === undefined) return value;
  return { ...value, projectId: normalized.scopeId } as T;
}

function pathWithEncodedQuery(url: URL): string {
  const query = encodeQueryParams(url.searchParams);
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function normalizeSelectorValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
