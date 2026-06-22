import { createHash } from "node:crypto";
import type {
  McpClientTransportConfig,
  McpEnterpriseManagedAuthorizationConfig,
  McpOAuthAuthorizationCodeConfig,
  McpOAuthClientCredentialsAuthorizationConfig,
  McpOAuthClientCredentialsClientConfig,
  McpOAuthClientIdentityConfig,
  McpStreamableHttpAuthorizationConfig,
} from "./client.js";
import { stableRecordEntries } from "./client-authorization-protocol.js";

export type RemoteMcpTaskServerMatch =
  | { kind: "safe" }
  | { kind: "ambiguous"; reason: string };

export type RemoteMcpServerIdentity = {
  fingerprint: string;
  match: RemoteMcpTaskServerMatch;
};

export function remoteMcpServerIdentity(
  transport: McpClientTransportConfig,
): RemoteMcpServerIdentity {
  const input = remoteMcpServerIdentityInput(transport);
  return {
    fingerprint: createHash("sha256").update(JSON.stringify(input.value)).digest("hex"),
    match: input.match,
  };
}

function remoteMcpServerIdentityInput(
  transport: McpClientTransportConfig,
): { value: object; match: RemoteMcpTaskServerMatch } {
  if (transport.type === "http") {
    const headerNames = stableRecordEntries(transport.headers)
      .map(([key]) => key.toLowerCase())
      .sort();
    return {
      value: {
        type: "http",
        url: new URL(transport.url).toString(),
        headerNames,
        authorization: redactedAuthorizationFingerprintInput(transport.authorization),
      },
      match: headerNames.length > 0
        ? {
            kind: "ambiguous",
            reason:
              "HTTP headers contain values that are intentionally not persisted, so this task cannot be matched safely after restart.",
          }
        : { kind: "safe" },
    };
  }

  const envKeys = stableRecordEntries(transport.env)
    .map(([key]) => key)
    .sort();
  return {
    value: {
      type: "stdio",
      command: transport.command,
      args: transport.args ?? [],
      envKeys,
    },
    match: envKeys.length > 0
      ? {
          kind: "ambiguous",
          reason:
            "stdio environment values are intentionally not persisted, so this task cannot be matched safely after restart.",
        }
      : { kind: "safe" },
  };
}

function redactedAuthorizationFingerprintInput(
  authorization: McpStreamableHttpAuthorizationConfig | undefined,
): object | null {
  if (!authorization) return null;
  if (authorization.type === "oauth") {
    return oauthAuthorizationFingerprintInput(authorization);
  }
  if (authorization.type === "oauth-client-credentials") {
    return oauthClientCredentialsFingerprintInput(authorization);
  }
  return enterpriseManagedFingerprintInput(authorization);
}

function oauthAuthorizationFingerprintInput(
  authorization: McpOAuthAuthorizationCodeConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    redirectUri: authorization.redirectUri,
    scopes: authorization.scopes,
    client: oauthClientIdentityFingerprintInput(authorization.client),
  };
}

function oauthClientIdentityFingerprintInput(
  client: McpOAuthClientIdentityConfig,
): object {
  if (client.kind === "registered") {
    return {
      kind: client.kind,
      clientId: client.clientId,
      hasClientSecret: client.clientSecret !== undefined,
    };
  }
  if (client.kind === "client-id-metadata-url") {
    return {
      kind: client.kind,
      clientId: client.clientId,
    };
  }
  return {
    kind: client.kind,
    clientName: client.clientName,
    dynamicClientRegistration: client.dynamicClientRegistration,
  };
}

function oauthClientCredentialsFingerprintInput(
  authorization: McpOAuthClientCredentialsAuthorizationConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    scopes: authorization.scopes,
    tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
    client: oauthClientCredentialsClientFingerprintInput(authorization.client),
  };
}

function oauthClientCredentialsClientFingerprintInput(
  client: McpOAuthClientCredentialsClientConfig,
): object {
  if ("clientSecret" in client) {
    return {
      kind: client.kind,
      clientId: client.clientId,
      credential: "client_secret",
    };
  }
  return {
    kind: client.kind,
    clientId: client.clientId,
    credential: "private_key_jwt",
    signingAlgorithm: client.signingAlgorithm,
    hasKeyId: client.keyId !== undefined,
  };
}

function enterpriseManagedFingerprintInput(
  authorization: McpEnterpriseManagedAuthorizationConfig,
): object {
  return {
    type: authorization.type,
    issuer: authorization.issuer,
    resource: authorization.resource,
    scopes: authorization.scopes,
    identityProvider: authorization.identityProvider,
    subjectToken: {
      tokenType: authorization.subjectToken.tokenType,
      source: authorization.subjectToken.source.kind === "env"
        ? authorization.subjectToken.source
        : { kind: "static", hasToken: true },
    },
    tokenEndpointAuthMethod: authorization.tokenEndpointAuthMethod,
    client: oauthClientCredentialsClientFingerprintInput(authorization.client),
  };
}
