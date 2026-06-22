import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import type {
  McpEnterpriseManagedIdentityProviderConfig,
  McpEnterpriseManagedSubjectTokenConfig,
  McpEnterpriseManagedSubjectTokenSourceConfig,
  McpEnterpriseManagedSubjectTokenType,
  McpOAuthClientCredentialsClientSecretBasicClientConfig,
  McpOAuthClientCredentialsPrivateKeyJwtClientConfig,
  McpOAuthClientIdentityConfig,
} from "./client.js";
import {
  assertNoUnknownObjectFields,
  isJsonObject,
  requiredString,
} from "./manager-config-utils.js";

const MCP_ENTERPRISE_MANAGED_IDENTITY_PROVIDER_FIELDS = new Set([
  "issuer",
  "tokenEndpoint",
]);
const MCP_ENTERPRISE_MANAGED_SUBJECT_TOKEN_FIELDS = new Set([
  "tokenType",
  "source",
]);
const MCP_ENTERPRISE_MANAGED_STATIC_SUBJECT_TOKEN_SOURCE_FIELDS = new Set([
  "kind",
  "token",
]);
const MCP_ENTERPRISE_MANAGED_ENV_SUBJECT_TOKEN_SOURCE_FIELDS = new Set([
  "kind",
  "name",
]);
const MCP_OAUTH_REGISTERED_CLIENT_FIELDS = new Set(["kind", "clientId", "clientSecret"]);
const MCP_OAUTH_CLIENT_ID_METADATA_URL_FIELDS = new Set(["kind", "clientId"]);
const MCP_OAUTH_DYNAMIC_CLIENT_FIELDS = new Set([
  "kind",
  "clientName",
  "dynamicClientRegistration",
]);
const MCP_OAUTH_CLIENT_CREDENTIALS_CLIENT_SECRET_BASIC_FIELDS = new Set([
  "kind",
  "clientId",
  "clientSecret",
]);
const MCP_OAUTH_CLIENT_CREDENTIALS_PRIVATE_KEY_JWT_FIELDS = new Set([
  "kind",
  "clientId",
  "privateKeyPem",
  "signingAlgorithm",
  "keyId",
]);

export function decodeMcpOAuthClientIdentity(
  value: KotaJsonValue | undefined,
): McpOAuthClientIdentityConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.client must be an object");
  }
  const kind = requiredString(value.kind, "authorization.client.kind");
  if (kind === "registered") {
    assertNoUnknownObjectFields("authorization.client", value, MCP_OAUTH_REGISTERED_CLIENT_FIELDS);
    const clientId = requiredString(value.clientId, "authorization.client.clientId");
    if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
      throw new Error("authorization.client.clientSecret must be a string");
    }
    return {
      kind,
      clientId,
      ...(value.clientSecret !== undefined ? { clientSecret: value.clientSecret } : {}),
    };
  }
  if (kind === "client-id-metadata-url") {
    assertNoUnknownObjectFields(
      "authorization.client",
      value,
      MCP_OAUTH_CLIENT_ID_METADATA_URL_FIELDS,
    );
    return {
      kind,
      clientId: requiredString(value.clientId, "authorization.client.clientId"),
    };
  }
  if (kind === "dynamic") {
    assertNoUnknownObjectFields("authorization.client", value, MCP_OAUTH_DYNAMIC_CLIENT_FIELDS);
    const registration = value.dynamicClientRegistration;
    if (!isJsonObject(registration)) {
      throw new Error("authorization.client.dynamicClientRegistration must be an object");
    }
    if (registration.enabled !== true) {
      throw new Error("OAuth dynamic client registration is disabled");
    }
    return {
      kind,
      clientName: requiredString(value.clientName, "authorization.client.clientName"),
      dynamicClientRegistration: { enabled: true },
    };
  }
  throw new Error("authorization.client.kind must be registered, client-id-metadata-url, or dynamic");
}

export function decodeMcpOAuthClientCredentialsClientSecretBasic(
  value: KotaJsonValue | undefined,
): McpOAuthClientCredentialsClientSecretBasicClientConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.client must be an object");
  }
  assertNoUnknownObjectFields(
    "authorization.client",
    value,
    MCP_OAUTH_CLIENT_CREDENTIALS_CLIENT_SECRET_BASIC_FIELDS,
  );
  const kind = requiredString(value.kind, "authorization.client.kind");
  if (kind !== "registered") {
    throw new Error("authorization.client.kind must be registered for client credentials");
  }
  return {
    kind,
    clientId: requiredString(value.clientId, "authorization.client.clientId"),
    clientSecret: requiredString(value.clientSecret, "authorization.client.clientSecret"),
  };
}

export function decodeMcpOAuthClientCredentialsPrivateKeyJwtClient(
  value: KotaJsonValue | undefined,
): McpOAuthClientCredentialsPrivateKeyJwtClientConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.client must be an object");
  }
  assertNoUnknownObjectFields(
    "authorization.client",
    value,
    MCP_OAUTH_CLIENT_CREDENTIALS_PRIVATE_KEY_JWT_FIELDS,
  );
  const kind = requiredString(value.kind, "authorization.client.kind");
  if (kind !== "registered") {
    throw new Error("authorization.client.kind must be registered for client credentials");
  }
  const keyId = value.keyId === undefined
    ? undefined
    : requiredString(value.keyId, "authorization.client.keyId");
  return {
    kind,
    clientId: requiredString(value.clientId, "authorization.client.clientId"),
    privateKeyPem: requiredString(value.privateKeyPem, "authorization.client.privateKeyPem"),
    signingAlgorithm: decodePrivateKeyJwtSigningAlgorithm(value.signingAlgorithm),
    ...(keyId !== undefined ? { keyId } : {}),
  };
}

function decodePrivateKeyJwtSigningAlgorithm(
  value: KotaJsonValue | undefined,
): "RS256" {
  if (value !== "RS256") {
    throw new Error("authorization.client.signingAlgorithm must be RS256 for private_key_jwt");
  }
  return value;
}

export function decodeEnterpriseManagedIdentityProvider(
  value: KotaJsonValue | undefined,
): McpEnterpriseManagedIdentityProviderConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.identityProvider must be an object");
  }
  assertNoUnknownObjectFields(
    "authorization.identityProvider",
    value,
    MCP_ENTERPRISE_MANAGED_IDENTITY_PROVIDER_FIELDS,
  );
  return {
    issuer: requiredString(value.issuer, "authorization.identityProvider.issuer"),
    tokenEndpoint: requiredString(value.tokenEndpoint, "authorization.identityProvider.tokenEndpoint"),
  };
}

export function decodeEnterpriseManagedSubjectToken(
  value: KotaJsonValue | undefined,
): McpEnterpriseManagedSubjectTokenConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.subjectToken must be an object");
  }
  assertNoUnknownObjectFields(
    "authorization.subjectToken",
    value,
    MCP_ENTERPRISE_MANAGED_SUBJECT_TOKEN_FIELDS,
  );
  return {
    tokenType: decodeEnterpriseManagedSubjectTokenType(value.tokenType),
    source: decodeEnterpriseManagedSubjectTokenSource(value.source),
  };
}

function decodeEnterpriseManagedSubjectTokenType(
  value: KotaJsonValue | undefined,
): McpEnterpriseManagedSubjectTokenType {
  if (
    value !== "urn:ietf:params:oauth:token-type:id_token" &&
    value !== "urn:ietf:params:oauth:token-type:saml2"
  ) {
    throw new Error(
      "authorization.subjectToken.tokenType must be urn:ietf:params:oauth:token-type:id_token or urn:ietf:params:oauth:token-type:saml2",
    );
  }
  return value;
}

function decodeEnterpriseManagedSubjectTokenSource(
  value: KotaJsonValue | undefined,
): McpEnterpriseManagedSubjectTokenSourceConfig {
  if (!isJsonObject(value)) {
    throw new Error("authorization.subjectToken.source must be an object");
  }
  const kind = requiredString(value.kind, "authorization.subjectToken.source.kind");
  if (kind === "static") {
    assertNoUnknownObjectFields(
      "authorization.subjectToken.source",
      value,
      MCP_ENTERPRISE_MANAGED_STATIC_SUBJECT_TOKEN_SOURCE_FIELDS,
    );
    return {
      kind,
      token: requiredString(value.token, "authorization.subjectToken.source.token"),
    };
  }
  if (kind === "env") {
    assertNoUnknownObjectFields(
      "authorization.subjectToken.source",
      value,
      MCP_ENTERPRISE_MANAGED_ENV_SUBJECT_TOKEN_SOURCE_FIELDS,
    );
    return {
      kind,
      name: requiredString(value.name, "authorization.subjectToken.source.name"),
    };
  }
  throw new Error("authorization.subjectToken.source.kind must be static or env");
}
