import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import type {
  McpAuthorizationChallenge,
  McpAuthorizationServerMetadata,
  McpClientTransportConfig,
  McpOAuthClientCredentialsClientConfig,
  McpOAuthClientCredentialsClientSecretBasicClientConfig,
  McpOAuthClientCredentialsPrivateKeyJwtClientConfig,
  McpOAuthClientIdentityConfig,
  McpOAuthTokenSet,
  McpProtectedResourceMetadata,
  McpStreamableHttpAuthorizationConfig,
  NormalizedMcpClientTransport,
  NormalizedMcpOAuthClientCredentialsClient,
  NormalizedMcpOAuthClientCredentialsClientSecretBasicClient,
  NormalizedMcpOAuthClientCredentialsPrivateKeyJwtClient,
  NormalizedMcpOAuthClientIdentity,
  NormalizedMcpStreamableHttpAuthorizationConfig,
} from "./client-auth-types.js";
import {
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireJsonObject,
  requireString,
  requireStringArray,
} from "./client-decode-utils.js";
import { validatePrivateKeyJwtSigningConfig } from "./client-oauth-private-key-jwt.js";
import type { JsonRpcResult } from "./client-protocol.js";

export const MCP_OAUTH_CLIENT_CREDENTIALS_EXTENSION_ID =
  "io.modelcontextprotocol/oauth-client-credentials";

export function parseWwwAuthenticateChallenge(
  header: string | null,
): McpAuthorizationChallenge | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer")) return null;
  const params = parseAuthenticateParams(trimmed.slice("bearer".length));
  const scopes = splitScopeParam(params.scope);
  return {
    scheme: "Bearer",
    scopes,
    ...(params.resource_metadata !== undefined && {
      resourceMetadataUrl: params.resource_metadata,
    }),
    ...(params.error !== undefined && { error: params.error }),
  };
}

export function parseAuthenticateParams(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index] ?? "")) index += 1;
    const keyStart = index;
    while (index < value.length && /[A-Za-z0-9_-]/.test(value[index] ?? "")) index += 1;
    const key = value.slice(keyStart, index).toLowerCase();
    while (index < value.length && /\s/.test(value[index] ?? "")) index += 1;
    if (!key || value[index] !== "=") break;
    index += 1;
    while (index < value.length && /\s/.test(value[index] ?? "")) index += 1;
    const parsed = parseAuthenticateParamValue(value, index);
    if (!parsed) break;
    params[key] = parsed.value;
    index = parsed.nextIndex;
  }
  return params;
}

export function parseAuthenticateParamValue(
  value: string,
  start: number,
): { value: string; nextIndex: number } | null {
  if (value[start] !== "\"") {
    let index = start;
    while (index < value.length && value[index] !== ",") index += 1;
    return { value: value.slice(start, index).trim(), nextIndex: index };
  }
  let index = start + 1;
  let out = "";
  while (index < value.length) {
    const char = value[index];
    if (char === "\"") {
      return { value: out, nextIndex: index + 1 };
    }
    if (char === "\\" && index + 1 < value.length) {
      out += value[index + 1];
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return null;
}

export function splitScopeParam(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(/\s+/).filter((scope) => scope.length > 0);
}

export function uniqueScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.filter((scope) => scope.length > 0))];
}

export function scopeSetIncludesAll(granted: readonly string[], required: readonly string[]): boolean {
  return scopesNotIncluded(required, granted).length === 0;
}

export function scopesNotIncluded(
  required: readonly string[],
  available: readonly string[],
): string[] {
  const availableSet = new Set(available);
  return uniqueScopes(required).filter((scope) => !availableSet.has(scope));
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateOAuthVerifier(): string {
  return base64Url(randomBytes(64));
}

export function generateOAuthState(): string {
  return base64Url(randomBytes(32));
}

export function protectedResourceMetadataWellKnownUrls(resourceUrl: string): string[] {
  const url = new URL(resourceUrl);
  const basePath = url.pathname === "/"
    ? ""
    : url.pathname.replace(/\/+$/, "");
  const candidates = [
    new URL(`/.well-known/oauth-protected-resource${basePath}`, url.origin).toString(),
    new URL("/.well-known/oauth-protected-resource", url.origin).toString(),
  ];
  return [...new Set(candidates)];
}

export function authorizationServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const basePath = url.pathname === "/"
    ? ""
    : url.pathname.replace(/\/+$/, "");
  const oauthMetadata = new URL(
    `/.well-known/oauth-authorization-server${basePath}`,
    url.origin,
  ).toString();
  const oauthStyleOpenIdMetadata = new URL(
    `/.well-known/openid-configuration${basePath}`,
    url.origin,
  ).toString();
  const openIdDiscoveryMetadata = new URL(
    `${basePath}/.well-known/openid-configuration`,
    url.origin,
  ).toString();
  return [...new Set([
    oauthMetadata,
    oauthStyleOpenIdMetadata,
    openIdDiscoveryMetadata,
  ])];
}

export function decodeProtectedResourceMetadata(
  value: JsonRpcResult,
): McpProtectedResourceMetadata {
  const object = requireJsonObject(value, "metadata", "protected-resource-metadata");
  return {
    resource: requireString(
      object.resource,
      "resource",
      "protected-resource-metadata",
    ),
    authorizationServers: requireStringArray(
      object.authorization_servers,
      "authorization_servers",
      "protected-resource-metadata",
    ),
    bearerMethodsSupported: optionalStringArray(
      object.bearer_methods_supported,
      "bearer_methods_supported",
      "protected-resource-metadata",
    ) ?? [],
    scopesSupported: optionalStringArray(
      object.scopes_supported,
      "scopes_supported",
      "protected-resource-metadata",
    ) ?? [],
  };
}

export function decodeAuthorizationServerMetadata(
  value: JsonRpcResult,
): McpAuthorizationServerMetadata {
  const object = requireJsonObject(value, "metadata", "authorization-server-metadata");
  return {
    issuer: requireString(object.issuer, "issuer", "authorization-server-metadata"),
    ...(object.authorization_endpoint !== undefined
      ? {
          authorizationEndpoint: requireString(
            object.authorization_endpoint,
            "authorization_endpoint",
            "authorization-server-metadata",
          ),
        }
      : {}),
    tokenEndpoint: requireString(
      object.token_endpoint,
      "token_endpoint",
      "authorization-server-metadata",
    ),
    ...(object.registration_endpoint !== undefined
      ? {
          registrationEndpoint: requireString(
            object.registration_endpoint,
            "registration_endpoint",
            "authorization-server-metadata",
          ),
        }
      : {}),
    scopesSupported: optionalStringArray(
      object.scopes_supported,
      "scopes_supported",
      "authorization-server-metadata",
    ) ?? [],
    codeChallengeMethodsSupported: optionalStringArray(
      object.code_challenge_methods_supported,
      "code_challenge_methods_supported",
      "authorization-server-metadata",
    ) ?? [],
    tokenEndpointAuthMethodsSupported: optionalStringArray(
      object.token_endpoint_auth_methods_supported,
      "token_endpoint_auth_methods_supported",
      "authorization-server-metadata",
    ) ?? [],
    authorizationResponseIssuerRequired: optionalBoolean(
      object.authorization_response_iss_parameter_supported,
      "authorization_response_iss_parameter_supported",
      "authorization-server-metadata",
    ) ?? false,
  };
}

export function decodeOAuthTokenSet(
  value: JsonRpcResult,
  previousRefreshToken?: string,
): McpOAuthTokenSet {
  const object = requireJsonObject(value, "token", "oauth-token");
  const tokenType = requireString(object.token_type, "token_type", "oauth-token");
  if (tokenType.toLowerCase() !== "bearer") {
    throw new Error("Malformed OAuth token response: token_type must be Bearer");
  }
  const scope = optionalString(object.scope, "scope", "oauth-token");
  const expiresIn = optionalNumber(object.expires_in, "expires_in", "oauth-token");
  const refreshToken = optionalString(object.refresh_token, "refresh_token", "oauth-token");
  return {
    accessToken: requireString(object.access_token, "access_token", "oauth-token"),
    scopes: splitScopeParam(scope),
    ...(refreshToken !== undefined
      ? { refreshToken }
      : previousRefreshToken !== undefined
        ? { refreshToken: previousRefreshToken }
        : {}),
    ...(expiresIn !== undefined
      ? { expiresAtMs: Date.now() + Math.max(0, expiresIn) * 1000 }
      : {}),
  };
}

export function normalizeHttpUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.toString();
}

export function normalizeHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https`);
  }
  return url.toString();
}

export function validateOAuthIssuer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OAuth issuer must use http or https");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error("OAuth issuer must not include query or fragment");
  }
  return value;
}

export function normalizeOAuthClientIdentity(
  client: McpOAuthClientIdentityConfig,
): NormalizedMcpOAuthClientIdentity {
  if (client.kind === "registered") {
    if (client.clientId.length === 0) {
      throw new Error("OAuth registered clientId must not be empty");
    }
    return {
      kind: "registered",
      clientId: client.clientId,
      ...(client.clientSecret !== undefined ? { clientSecret: client.clientSecret } : {}),
    };
  }
  if (client.kind === "client-id-metadata-url") {
    return {
      kind: "client-id-metadata-url",
      clientId: normalizeHttpsUrl(
        client.clientId,
        "OAuth client-id metadata document URL",
      ),
    };
  }
  if (client.kind === "dynamic") {
    if (client.dynamicClientRegistration.enabled !== true) {
      throw new Error("OAuth dynamic client registration is disabled");
    }
    if (client.clientName.length === 0) {
      throw new Error("OAuth dynamic clientName must not be empty");
    }
    return {
      kind: "dynamic",
      clientName: client.clientName,
      dynamicClientRegistration: { enabled: true },
    };
  }
  throw new Error("OAuth client identity kind is unsupported");
}

export function normalizeOAuthClientCredentialsClient(
  client: McpOAuthClientCredentialsClientConfig,
): NormalizedMcpOAuthClientCredentialsClient {
  if ("clientSecret" in client) {
    return normalizeOAuthClientCredentialsClientSecretBasic(client);
  }
  if ("privateKeyPem" in client) {
    return normalizeOAuthClientCredentialsPrivateKeyJwtClient(client);
  }
  throw new Error("OAuth client credentials client is malformed");
}

export function normalizeOAuthClientCredentialsClientSecretBasic(
  client: McpOAuthClientCredentialsClientSecretBasicClientConfig,
): NormalizedMcpOAuthClientCredentialsClientSecretBasicClient {
  assertNoUnexpectedClientCredentialsFields(
    client,
    ["kind", "clientId", "clientSecret"],
    "client_secret_basic",
  );
  if (client.kind !== "registered") {
    throw new Error("OAuth client credentials require a registered client");
  }
  if (typeof client.clientId !== "string" || client.clientId.length === 0) {
    throw new Error("OAuth client credentials clientId must be a non-empty string");
  }
  if (typeof client.clientSecret !== "string" || client.clientSecret.length === 0) {
    throw new Error("OAuth client credentials clientSecret must be a non-empty string");
  }
  return {
    kind: "registered",
    clientId: client.clientId,
    clientSecret: client.clientSecret,
  };
}

export function normalizeOAuthClientCredentialsPrivateKeyJwtClient(
  client: McpOAuthClientCredentialsPrivateKeyJwtClientConfig,
): NormalizedMcpOAuthClientCredentialsPrivateKeyJwtClient {
  assertNoUnexpectedClientCredentialsFields(
    client,
    ["kind", "clientId", "privateKeyPem", "signingAlgorithm", "keyId"],
    "private_key_jwt",
  );
  if (client.kind !== "registered") {
    throw new Error("OAuth client credentials require a registered client");
  }
  if (typeof client.clientId !== "string" || client.clientId.length === 0) {
    throw new Error("OAuth client credentials clientId must be a non-empty string");
  }
  if (typeof client.privateKeyPem !== "string" || client.privateKeyPem.length === 0) {
    throw new Error("OAuth client credentials privateKeyPem must be a non-empty string");
  }
  if (client.signingAlgorithm !== "RS256") {
    throw new Error(
      "OAuth client credentials private_key_jwt signingAlgorithm must be RS256",
    );
  }
  if (
    client.keyId !== undefined &&
    (typeof client.keyId !== "string" || client.keyId.length === 0)
  ) {
    throw new Error("OAuth client credentials keyId must be a non-empty string");
  }
  const normalized = {
    kind: "registered" as const,
    clientId: client.clientId,
    privateKeyPem: client.privateKeyPem,
    signingAlgorithm: client.signingAlgorithm,
    ...(client.keyId !== undefined ? { keyId: client.keyId } : {}),
  };
  validatePrivateKeyJwtSigningConfig(normalized);
  return normalized;
}

function assertNoUnexpectedClientCredentialsFields(
  client: McpOAuthClientCredentialsClientConfig,
  allowedFields: readonly string[],
  tokenEndpointAuthMethod: string,
): void {
  const allowed = new Set(allowedFields);
  const unexpectedFields = Object.keys(client).filter((field) => !allowed.has(field));
  if (unexpectedFields.length === 0) return;
  throw new Error(
    `OAuth client credentials ${tokenEndpointAuthMethod} client has unexpected field${unexpectedFields.length === 1 ? "" : "s"} ${unexpectedFields.join(", ")}`,
  );
}

export function clientSecretBasicAuthorizationHeader(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${Buffer.from(
    `${oauthBasicCredentialPart(clientId)}:${oauthBasicCredentialPart(clientSecret)}`,
    "utf8",
  ).toString("base64")}`;
}

function oauthBasicCredentialPart(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function normalizeMcpAuthorizationConfig(
  authorization: McpStreamableHttpAuthorizationConfig,
): NormalizedMcpStreamableHttpAuthorizationConfig {
  if (authorization.type === "oauth") {
    return {
      type: "oauth",
      issuer: validateOAuthIssuer(authorization.issuer),
      redirectUri: normalizeHttpUrl(authorization.redirectUri, "OAuth redirectUri"),
      scopes: [...new Set(authorization.scopes)],
      client: normalizeOAuthClientIdentity(authorization.client),
    };
  }
  if (authorization.type === "oauth-client-credentials") {
    if (authorization.tokenEndpointAuthMethod === "client_secret_basic") {
      return {
        type: "oauth-client-credentials",
        issuer: validateOAuthIssuer(authorization.issuer),
        scopes: [...new Set(authorization.scopes)],
        tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
        client: normalizeOAuthClientCredentialsClientSecretBasic(authorization.client),
      };
    }
    if (authorization.tokenEndpointAuthMethod === "private_key_jwt") {
      return {
        type: "oauth-client-credentials",
        issuer: validateOAuthIssuer(authorization.issuer),
        scopes: [...new Set(authorization.scopes)],
        tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
        client: normalizeOAuthClientCredentialsPrivateKeyJwtClient(authorization.client),
      };
    }
    unsupportedTokenEndpointAuthMethod();
  }
  throw new Error("MCP HTTP authorization type must be oauth or oauth-client-credentials");
}

function unsupportedTokenEndpointAuthMethod(): never {
  throw new Error(
    "OAuth client credentials tokenEndpointAuthMethod must be client_secret_basic or private_key_jwt",
  );
}

export function hasStaticAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

export function normalizeClientTransportConfig(
  config: McpClientTransportConfig,
): NormalizedMcpClientTransport {
  if (config.type === "http") {
    const url = new URL(config.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("MCP HTTP transport URL must use http or https");
    }
    if (hasStaticAuthorizationHeader(config.headers) && config.authorization) {
      throw new Error(
        "MCP HTTP transport cannot combine static Authorization headers with acquired OAuth tokens",
      );
    }
    return {
      type: "http",
      url: url.toString(),
      ...(config.headers ? { headers: { ...config.headers } } : {}),
      ...(config.authorization
        ? { authorization: normalizeMcpAuthorizationConfig(config.authorization) }
        : {}),
    };
  }
  return {
    type: "stdio",
    command: config.command,
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.env ? { env: { ...config.env } } : {}),
  };
}

export function stableRecordEntries(record: Record<string, string> | undefined): [string, string][] {
  if (!record) return [];
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

export function authorizationContextKey(transport: NormalizedMcpClientTransport): string {
  const context = transport.type === "http"
    ? {
        type: "http",
        url: transport.url,
        headers: stableRecordEntries(transport.headers),
        authorization: transport.authorization
          ? {
              type: transport.authorization.type,
              issuer: transport.authorization.issuer,
              scopes: transport.authorization.scopes,
              ...(transport.authorization.type === "oauth"
                ? {
                    redirectUri: transport.authorization.redirectUri,
                    client: transport.authorization.client.kind === "registered"
                      ? {
                          kind: "registered",
                          clientId: transport.authorization.client.clientId,
                          hasClientSecret: transport.authorization.client.clientSecret !== undefined,
                        }
                      : transport.authorization.client,
                  }
                : {
                    tokenEndpointAuthMethod: transport.authorization.tokenEndpointAuthMethod,
                    client: {
                      kind: "registered",
                      clientId: transport.authorization.client.clientId,
                      credential:
                        transport.authorization.tokenEndpointAuthMethod === "client_secret_basic"
                          ? "client_secret"
                          : "private_key_jwt",
                      ...(transport.authorization.tokenEndpointAuthMethod === "private_key_jwt"
                        ? {
                            signingAlgorithm:
                              transport.authorization.client.signingAlgorithm,
                            hasKeyId:
                              transport.authorization.client.keyId !== undefined,
                          }
                        : {}),
                    },
                  }),
            }
          : null,
      }
    : {
        type: "stdio",
        command: transport.command,
        args: transport.args ?? [],
        env: stableRecordEntries(transport.env),
      };
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
