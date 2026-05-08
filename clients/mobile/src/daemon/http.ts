// Shared daemon HTTP context and request helper used by every
// per-namespace handler in this directory. The mobile `DaemonClient`
// holds one of these and forwards it into the namespace functions, so
// each namespace file has one obvious entry point per route.

export interface DaemonHttp {
  baseUrl: string;
  token: string;
}

/**
 * Append `projectId=<id>` to a path. Used by every project-scoped daemon
 * route — the daemon's `resolveProjectIdParam` reads this query parameter
 * and rejects unknown ids with a typed `UnknownProjectError` body. Pass
 * `undefined` (or omit) to call the route without scoping; the daemon
 * resolves the registry's default.
 */
export function withProject(path: string, projectId: string | undefined): string {
  if (!projectId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}projectId=${encodeURIComponent(projectId)}`;
}

export async function daemonRequest<T>(
  http: DaemonHttp,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${http.baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${http.token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
