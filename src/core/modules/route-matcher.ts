/**
 * Shared HTTP path matching for module-contributed routes. Both the public
 * `RouteRegistration` surface and the daemon-control `ControlRouteRegistration`
 * surface use the same `:name` (and trailing `*name`) segment grammar, so the
 * matcher is owned in one place.
 *
 * Path grammar:
 * - literal segments match exactly: `/api/tasks`
 * - `:name` segments capture a single decoded path segment: `/api/tasks/:id`
 * - `*name` as a final segment captures the rest of the path (with `/`):
 *   `/assets/*rest`
 */

export type RoutePathParams = Record<string, string>;

export type RouteShape = {
  readonly method: string;
  readonly path: string;
};

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Match a single path against a route pattern. Returns the captured params
 * (possibly empty) on success, or null when the pattern does not match.
 *
 * Param values are URI-decoded when possible. If a segment carries malformed
 * percent-encoding the raw value is preserved so handlers can return their
 * own 400 response with a domain-specific error message instead of crashing
 * inside the matcher.
 */
export function matchRoutePath(
  pattern: string,
  path: string,
): RoutePathParams | null {
  if (!pattern.includes(":") && !pattern.includes("*")) {
    return pattern === path ? {} : null;
  }
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  const params: RoutePathParams = {};
  for (let i = 0; i < patternParts.length; i++) {
    const segment = patternParts[i];
    if (segment.startsWith("*")) {
      if (i !== patternParts.length - 1) return null;
      params[segment.slice(1)] = pathParts.slice(i).map(safeDecode).join("/");
      return params;
    }
    if (i >= pathParts.length) return null;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = safeDecode(pathParts[i]);
    } else if (segment !== pathParts[i]) {
      return null;
    }
  }
  return pathParts.length === patternParts.length ? params : null;
}

/**
 * Iterate over a route table and return the first route whose method/path
 * pattern matches. Exact-path routes win over `:name` patterns so that
 * reserved siblings (e.g. `/api/tasks/normalized` vs `/api/tasks/:id`) keep
 * their dedicated handlers.
 */
export function findRouteMatch<R extends RouteShape>(
  routes: readonly R[],
  method: string,
  path: string,
): { route: R; params: RoutePathParams } | null {
  let patternMatch: { route: R; params: RoutePathParams } | null = null;
  for (const route of routes) {
    if (route.method !== method) continue;
    const isExact = !route.path.includes(":") && !route.path.includes("*");
    if (isExact) {
      if (route.path === path) return { route, params: {} };
      continue;
    }
    if (patternMatch) continue;
    const params = matchRoutePath(route.path, path);
    if (params) patternMatch = { route, params };
  }
  return patternMatch;
}

/**
 * Iterate a keyed route table (e.g. the daemon-control `routeScopes` map).
 * Keys must be `"<METHOD> <pattern>"`. Returns the matched key plus extracted
 * params, exact-match first.
 */
export function findKeyedRouteMatch(
  keys: Iterable<string>,
  method: string,
  path: string,
): { key: string; params: RoutePathParams } | null {
  const exactKey = `${method} ${path}`;
  let patternMatch: { key: string; params: RoutePathParams } | null = null;
  for (const key of keys) {
    if (key === exactKey) return { key, params: {} };
    if (!key.startsWith(`${method} `)) continue;
    const pattern = key.slice(method.length + 1);
    if (!pattern.includes(":") && !pattern.includes("*")) continue;
    if (patternMatch) continue;
    const params = matchRoutePath(pattern, path);
    if (params) patternMatch = { key, params };
  }
  return patternMatch;
}
