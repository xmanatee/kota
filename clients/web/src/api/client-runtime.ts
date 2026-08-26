export function getAuthToken(): string {
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    localStorage.setItem("kota-auth-token", urlToken);
    history.replaceState(null, "", window.location.pathname);
    return urlToken;
  }
  return localStorage.getItem("kota-auth-token") ?? "";
}

let cachedToken = getAuthToken();
const DASHBOARD_REQUEST_HEADER = "X-Kota-Dashboard-Request";

function authHeaders(): Record<string, string> {
  if (!cachedToken) cachedToken = getAuthToken();
  return cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {};
}

function dashboardRequestHeaders(
  options?: RequestInit,
): Record<string, string> {
  const method = (options?.method ?? "GET").toUpperCase();
  return method === "GET" || method === "HEAD"
    ? {}
    : { [DASHBOARD_REQUEST_HEADER]: "1" };
}

export async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...dashboardRequestHeaders(options),
      ...options?.headers,
    },
  });
}

export async function apiJson<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export function withProject(path: string, projectId: string): string {
  if (!projectId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}projectId=${encodeURIComponent(projectId)}`;
}

export async function apiDecoded<T>(
  path: string,
  decode: (raw: unknown) => T,
  options?: RequestInit,
): Promise<T> {
  return decode(await apiJson<unknown>(path, options));
}
