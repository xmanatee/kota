import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type { McpStreamableHttpAuthorizationConfig } from "./client.js";
import {
  decodeEnterpriseManagedIdentityProvider,
  decodeEnterpriseManagedSubjectToken,
  decodeMcpOAuthClientCredentialsClientSecretBasic,
  decodeMcpOAuthClientCredentialsPrivateKeyJwtClient,
  decodeMcpOAuthClientIdentity,
} from "./manager-config-auth-clients.js";
import {
  assertNoUnknownObjectFields,
  isJsonObject,
  optionalStringArray,
  requiredString,
} from "./manager-config-utils.js";

const MCP_OAUTH_AUTHORIZATION_FIELDS = new Set([
  "type",
  "issuer",
  "redirectUri",
  "scopes",
  "client",
]);
const MCP_OAUTH_CLIENT_CREDENTIALS_AUTHORIZATION_FIELDS = new Set([
  "type",
  "issuer",
  "scopes",
  "tokenEndpointAuthMethod",
  "client",
]);
const MCP_ENTERPRISE_MANAGED_AUTHORIZATION_FIELDS = new Set([
  "type",
  "issuer",
  "resource",
  "scopes",
  "identityProvider",
  "subjectToken",
  "tokenEndpointAuthMethod",
  "client",
]);

function hasAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

export function decodeMcpAuthorizationConfig(
  value: KotaJsonValue | undefined,
  headers: Record<string, string> | undefined,
): McpStreamableHttpAuthorizationConfig | undefined {
  if (value === undefined) return undefined;
  if (hasAuthorizationHeader(headers)) {
    throw new Error(
      "MCP HTTP transport cannot combine static Authorization headers with acquired OAuth tokens",
    );
  }
  if (!isJsonObject(value)) {
    throw new Error("authorization must be an object");
  }
  const type = requiredString(value.type, "authorization.type");
  if (type === "oauth") {
    assertNoUnknownObjectFields("authorization", value, MCP_OAUTH_AUTHORIZATION_FIELDS);
    const scopes = optionalStringArray(value.scopes, "authorization.scopes");
    return {
      type,
      issuer: requiredString(value.issuer, "authorization.issuer"),
      redirectUri: requiredString(value.redirectUri, "authorization.redirectUri"),
      scopes: scopes ?? [],
      client: decodeMcpOAuthClientIdentity(value.client),
    };
  }
  if (type === "oauth-client-credentials") {
    assertNoUnknownObjectFields(
      "authorization",
      value,
      MCP_OAUTH_CLIENT_CREDENTIALS_AUTHORIZATION_FIELDS,
    );
    const tokenEndpointAuthMethod = requiredString(
      value.tokenEndpointAuthMethod,
      "authorization.tokenEndpointAuthMethod",
    );
    const scopes = optionalStringArray(value.scopes, "authorization.scopes");
    if (tokenEndpointAuthMethod === "client_secret_basic") {
      return {
        type,
        issuer: requiredString(value.issuer, "authorization.issuer"),
        scopes: scopes ?? [],
        tokenEndpointAuthMethod,
        client: decodeMcpOAuthClientCredentialsClientSecretBasic(value.client),
      };
    }
    if (tokenEndpointAuthMethod === "private_key_jwt") {
      return {
        type,
        issuer: requiredString(value.issuer, "authorization.issuer"),
        scopes: scopes ?? [],
        tokenEndpointAuthMethod,
        client: decodeMcpOAuthClientCredentialsPrivateKeyJwtClient(value.client),
      };
    }
    throw new Error("authorization.tokenEndpointAuthMethod must be client_secret_basic or private_key_jwt");
  }
  if (type === "enterprise-managed") {
    return decodeEnterpriseManagedAuthorization(value, type);
  }
  throw new Error("authorization.type must be oauth, oauth-client-credentials, or enterprise-managed");
}

function decodeEnterpriseManagedAuthorization(
  value: Record<string, KotaJsonValue>,
  type: "enterprise-managed",
): McpStreamableHttpAuthorizationConfig {
  assertNoUnknownObjectFields(
    "authorization",
    value,
    MCP_ENTERPRISE_MANAGED_AUTHORIZATION_FIELDS,
  );
  const tokenEndpointAuthMethod = requiredString(
    value.tokenEndpointAuthMethod,
    "authorization.tokenEndpointAuthMethod",
  );
  const scopes = optionalStringArray(value.scopes, "authorization.scopes");
  if (tokenEndpointAuthMethod === "client_secret_basic") {
    return {
      type,
      issuer: requiredString(value.issuer, "authorization.issuer"),
      resource: requiredString(value.resource, "authorization.resource"),
      scopes: scopes ?? [],
      identityProvider: decodeEnterpriseManagedIdentityProvider(value.identityProvider),
      subjectToken: decodeEnterpriseManagedSubjectToken(value.subjectToken),
      tokenEndpointAuthMethod,
      client: decodeMcpOAuthClientCredentialsClientSecretBasic(value.client),
    };
  }
  if (tokenEndpointAuthMethod === "private_key_jwt") {
    return {
      type,
      issuer: requiredString(value.issuer, "authorization.issuer"),
      resource: requiredString(value.resource, "authorization.resource"),
      scopes: scopes ?? [],
      identityProvider: decodeEnterpriseManagedIdentityProvider(value.identityProvider),
      subjectToken: decodeEnterpriseManagedSubjectToken(value.subjectToken),
      tokenEndpointAuthMethod,
      client: decodeMcpOAuthClientCredentialsPrivateKeyJwtClient(value.client),
    };
  }
  throw new Error("authorization.tokenEndpointAuthMethod must be client_secret_basic or private_key_jwt");
}
