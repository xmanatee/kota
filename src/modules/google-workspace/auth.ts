import {
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpMethod,
  type OutboundHttpRequestPort,
  outboundHttp,
} from "#core/outbound-http/index.js";
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
  http: OutboundHttpRequestPort = outboundHttp,
): Promise<GoogleAccessTokenRefresh> {
  const { response: res } = await http.request({
    profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://oauth2.googleapis.com"]),
    operation: "google-workspace.refresh-token",
    url: "https://oauth2.googleapis.com/token",
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
  http: OutboundHttpRequestPort = outboundHttp,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(
    clientId,
    clientSecret,
    refreshToken,
    http,
  );
  tokenCache = {
    accessToken: refreshed.accessToken,
    expiresAt: now + refreshed.expiresIn * 1000,
  };
  return tokenCache.accessToken;
}

export async function googleFetch(
  token: string,
  method: OutboundHttpMethod,
  url: string,
  body?: unknown,
  http: OutboundHttpRequestPort = outboundHttp,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await googleRawFetch(token, method, url, body, http);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export async function googleRawFetch(
  token: string,
  method: OutboundHttpMethod,
  url: string,
  body?: unknown,
  http: OutboundHttpRequestPort = outboundHttp,
): Promise<Response> {
  const { response } = await http.request({
    profile: OUTBOUND_HTTP_PROFILES.configuredProvider([url]),
    operation: `google-workspace.${method.toLowerCase()}`,
    url,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return response;
}

export function apiError(action: string, status: number, data: unknown): ToolResult {
  const msg = (data as { error?: { message?: string } })?.error?.message ?? JSON.stringify(data);
  return { content: `Google API error (${status}) during ${action}: ${msg}`, is_error: true };
}
