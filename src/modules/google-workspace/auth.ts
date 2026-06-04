import type { ToolResult } from "#core/tools/tool-result.js";

export type GoogleWorkspaceSecretResolver = (key: string) => string | null;

export function resolveSecretReference(
  raw: string,
  getSecret: GoogleWorkspaceSecretResolver,
): string {
  if (raw.startsWith("$")) return getSecret(raw.slice(1)) ?? "";
  return raw;
}

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

export type GoogleAccessTokenRefresh = {
  accessToken: string;
  expiresIn: number;
};

export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<GoogleAccessTokenRefresh> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status})`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(clientId, clientSecret, refreshToken);
  tokenCache = {
    accessToken: refreshed.accessToken,
    expiresAt: now + refreshed.expiresIn * 1000,
  };
  return tokenCache.accessToken;
}

export async function googleFetch(
  token: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export function apiError(action: string, status: number, data: unknown): ToolResult {
  const msg = (data as { error?: { message?: string } })?.error?.message ?? JSON.stringify(data);
  return { content: `Google API error (${status}) during ${action}: ${msg}`, is_error: true };
}
