import {
  OUTBOUND_HTTP_PROFILES,
  outboundHttp,
} from "#core/outbound-http/index.js";
import type {
  McpAuthorizationServerMetadata,
  NormalizedMcpStreamableHttpAuthorizationConfig,
} from "./client-auth-types.js";
import { normalizeHttpsUrl } from "./client-authorization-protocol.js";
import { CONNECT_TIMEOUT } from "./client-protocol.js";

export async function normalizeAndValidateOAuthServerMetadataEndpoints(
  metadata: McpAuthorizationServerMetadata,
  authorization: NormalizedMcpStreamableHttpAuthorizationConfig,
): Promise<McpAuthorizationServerMetadata> {
  const normalized = {
    ...metadata,
    tokenEndpoint: normalizeHttpsUrl(metadata.tokenEndpoint, "token_endpoint"),
    ...(metadata.authorizationEndpoint !== undefined
      ? {
          authorizationEndpoint: normalizeHttpsUrl(
            metadata.authorizationEndpoint,
            "authorization_endpoint",
          ),
        }
      : {}),
    ...(metadata.registrationEndpoint !== undefined
      ? {
          registrationEndpoint: normalizeHttpsUrl(
            metadata.registrationEndpoint,
            "registration_endpoint",
          ),
        }
      : {}),
  };
  const endpoints: Array<readonly [label: string, url: string]> = [
    ["token_endpoint", normalized.tokenEndpoint],
  ];
  if (normalized.authorizationEndpoint !== undefined) {
    endpoints.push(["authorization_endpoint", normalized.authorizationEndpoint]);
  }
  if (normalized.registrationEndpoint !== undefined) {
    endpoints.push(["registration_endpoint", normalized.registrationEndpoint]);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
  try {
    for (const [label, url] of endpoints) {
      try {
        await outboundHttp.validateTarget(
          resolveMcpOAuthEndpointProfile(authorization, url),
          url,
          controller.signal,
        );
      } catch (error) {
        const message = controller.signal.aborted
          ? `validation timed out after ${CONNECT_TIMEOUT}ms`
          : error instanceof Error ? error.message : String(error);
        throw new Error(
          `authorization-server metadata ${label} rejected: ${message}`,
        );
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return normalized;
}

export function resolveMcpOAuthEndpointProfile(
  authorization: NormalizedMcpStreamableHttpAuthorizationConfig | undefined,
  url: string,
) {
  const configuredOrigins = configuredOAuthOrigins(authorization);
  const targetOrigin = new URL(url).origin;
  return configuredOrigins.includes(targetOrigin)
    ? OUTBOUND_HTTP_PROFILES.oauthProtectedResource(configuredOrigins)
    : OUTBOUND_HTTP_PROFILES.oauthMetadataEndpoint([url]);
}

function configuredOAuthOrigins(
  authorization: NormalizedMcpStreamableHttpAuthorizationConfig | undefined,
): string[] {
  if (authorization === undefined) return [];
  const configuredUrls = authorization.type === "enterprise-managed"
    ? [
        authorization.issuer,
        authorization.identityProvider.issuer,
        authorization.identityProvider.tokenEndpoint,
      ]
    : [authorization.issuer];
  return [
    ...new Set(
      configuredUrls.map((configuredUrl) => new URL(configuredUrl).origin),
    ),
  ];
}
