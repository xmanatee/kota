export type ScopeSelector = {
  scopeId?: string;
};

export type ScopeSelectorArgument = string | ScopeSelector | undefined;

export type NormalizedScopeSelector = {
  scopeId?: string;
};

export type ScopeSelectorConflictBody = {
  error: "Conflicting scope selectors";
  reason: "conflicting_scope_selectors";
  requestedScopeId: string;
  boundScopeId: string;
};

export type UnknownScopeSelectorBody = {
  error: "Unknown scope";
  reason: "unknown_scope";
  scopeId: string;
};

export type ScopeSelectorQueryNormalization =
  | { ok: true; changed: boolean; pathWithQuery: string }
  | { ok: false; status: 400; body: ScopeSelectorConflictBody };

export type ScopeSelectorResolution =
  | { ok: true; selector: NormalizedScopeSelector; selectedId?: string }
  | { ok: false; status: 400; body: ScopeSelectorConflictBody };

export class ScopeSelectorConflictError extends Error {
  readonly reason = "conflicting_scope_selectors" as const;
  readonly requestedScopeId: string;
  readonly boundScopeId: string;

  constructor(requestedScopeId: string, boundScopeId: string) {
    super(
      `Conflicting scope selectors: requested=${requestedScopeId}, bound=${boundScopeId}`,
    );
    this.name = "ScopeSelectorConflictError";
    this.requestedScopeId = requestedScopeId;
    this.boundScopeId = boundScopeId;
  }
}

export function normalizeScopeSelector(
  selector?: ScopeSelector,
): NormalizedScopeSelector {
  const scopeId = normalizeSelectorValue(selector?.scopeId);
  return scopeId === undefined ? {} : { scopeId };
}

export function normalizeScopeSelectorArgument(
  selector?: ScopeSelectorArgument,
): NormalizedScopeSelector {
  if (typeof selector === "string") {
    return normalizeScopeSelector({ scopeId: selector });
  }
  return normalizeScopeSelector(selector);
}

export function selectedScopeSelectorId(
  selector?: ScopeSelectorArgument,
): string | undefined {
  const normalized = normalizeScopeSelectorArgument(selector);
  return normalized.scopeId;
}

export function resolveScopeSelector(
  selector?: ScopeSelectorArgument,
): ScopeSelectorResolution {
  try {
    const normalized = normalizeScopeSelectorArgument(selector);
    return {
      ok: true,
      selector: normalized,
      selectedId: normalized.scopeId,
    };
  } catch (err) {
    if (!(err instanceof ScopeSelectorConflictError)) throw err;
    return { ok: false, status: 400, body: scopeSelectorConflictBody(err) };
  }
}

export function resolveScopeSelectorFromUrl(url: URL): ScopeSelectorResolution {
  return resolveScopeSelector({
    scopeId: url.searchParams.get("scopeId") ?? undefined,
  });
}

export function appendScopeSelector(
  params: URLSearchParams,
  selector?: ScopeSelectorArgument,
): void {
  const normalized = normalizeScopeSelectorArgument(selector);
  if (normalized.scopeId !== undefined) params.set("scopeId", normalized.scopeId);
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
  const valueId = valueSelector.scopeId;
  const enforcedId = enforcedSelector.scopeId;
  if (valueId !== undefined && enforcedId !== undefined && valueId !== enforcedId) {
    throw new ScopeSelectorConflictError(valueId, enforcedId);
  }
  return {
    ...(value ?? ({} as T)),
    ...(enforcedSelector.scopeId !== undefined ? { scopeId: enforcedSelector.scopeId } : {}),
  };
}

export function scopeSelectorConflictBody(
  error: ScopeSelectorConflictError,
): ScopeSelectorConflictBody {
  return {
    error: "Conflicting scope selectors",
    reason: "conflicting_scope_selectors",
    requestedScopeId: error.requestedScopeId,
    boundScopeId: error.boundScopeId,
  };
}

export function unknownScopeSelectorBody(selectedId: string): UnknownScopeSelectorBody {
  return {
    error: "Unknown scope",
    reason: "unknown_scope",
    scopeId: selectedId,
  };
}

export function normalizeScopeSelectorQueryUrl(
  url: URL,
): ScopeSelectorQueryNormalization {
  const resolved = resolveScopeSelectorFromUrl(url);
  if (!resolved.ok) return resolved;
  const { selector } = resolved;
  if (selector.scopeId === undefined) {
    return {
      ok: true,
      changed: false,
      pathWithQuery: pathWithEncodedQuery(url),
    };
  }
  url.searchParams.set("scopeId", selector.scopeId);
  return {
    ok: true,
    changed: true,
    pathWithQuery: pathWithEncodedQuery(url),
  };
}

export function normalizeScopeSelectorClientHandlers<T extends object>(
  handlers: T,
): T {
  for (const key of Object.keys(handlers) as Array<keyof T>) {
    const namespace = handlers[key];
    if (typeof namespace === "object" && namespace !== null) {
      wrapScopeSelectorNamespace(namespace);
    }
  }
  return handlers;
}

const scopeSelectorWrappedNamespaces = new WeakSet<object>();
type ScopeSelectorClientMethod = (...args: never[]) => never;
const scopeSelectorWrappedMethods = new WeakSet<ScopeSelectorClientMethod>();

function wrapScopeSelectorNamespace<T extends object>(namespace: T): T {
  if (scopeSelectorWrappedNamespaces.has(namespace)) return namespace;
  scopeSelectorWrappedNamespaces.add(namespace);
  for (const key of Object.keys(namespace) as Array<keyof T>) {
    const value = namespace[key];
    if (typeof value !== "function") continue;
    const method = value as ScopeSelectorClientMethod;
    if (scopeSelectorWrappedMethods.has(method)) continue;
    const wrapped: ScopeSelectorClientMethod = (...args: never[]) =>
      Reflect.apply(
        method,
        namespace,
        args.map((arg) => normalizeScopeSelectorClientArgument(arg)),
      ) as never;
    scopeSelectorWrappedMethods.add(wrapped);
    if (!Reflect.set(namespace, key, wrapped)) {
      throw new Error(`Unable to install scope selector normalizer for client method "${String(key)}"`);
    }
  }
  return namespace;
}

function normalizeScopeSelectorClientArgument<T>(value: T): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  if (!("scopeId" in value)) return value;
  const normalized = normalizeScopeSelector(value as ScopeSelector);
  if (normalized.scopeId === undefined) return value;
  return { ...value, scopeId: normalized.scopeId } as T;
}

function pathWithEncodedQuery(url: URL): string {
  const query = encodeQueryParams(url.searchParams);
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function normalizeSelectorValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
