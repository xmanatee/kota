import type {
  McpElicitationMode,
  McpLogMessageHandler,
} from "./client-protocol.js";

export type McpClientOptions = {
  supportedElicitationModes?: readonly McpElicitationMode[];
  authorizationResolver?: McpAuthorizationResolver;
  onLogMessage?: McpLogMessageHandler;
};

export type McpStdioClientTransportConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpStreamableHttpClientTransportConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  authorization?: McpStreamableHttpAuthorizationConfig;
};

export type McpOAuthRegisteredClientConfig = {
  kind: "registered";
  clientId: string;
  clientSecret?: string;
};

export type McpOAuthClientIdMetadataUrlConfig = {
  kind: "client-id-metadata-url";
  clientId: string;
};

export type McpOAuthDynamicClientConfig = {
  kind: "dynamic";
  clientName: string;
  dynamicClientRegistration: { enabled: boolean };
};

export type McpOAuthClientIdentityConfig =
  | McpOAuthRegisteredClientConfig
  | McpOAuthClientIdMetadataUrlConfig
  | McpOAuthDynamicClientConfig;

export type McpOAuthAuthorizationCodeConfig = {
  type: "oauth";
  issuer: string;
  redirectUri: string;
  scopes: string[];
  client: McpOAuthClientIdentityConfig;
};

export type McpOAuthClientCredentialsTokenEndpointAuthMethod = "client_secret_basic";

export type McpOAuthClientCredentialsClientConfig = {
  kind: "registered";
  clientId: string;
  clientSecret: string;
};

export type McpOAuthClientCredentialsAuthorizationConfig = {
  type: "oauth-client-credentials";
  issuer: string;
  scopes: string[];
  tokenEndpointAuthMethod: McpOAuthClientCredentialsTokenEndpointAuthMethod;
  client: McpOAuthClientCredentialsClientConfig;
};

export type McpStreamableHttpAuthorizationConfig =
  | McpOAuthAuthorizationCodeConfig
  | McpOAuthClientCredentialsAuthorizationConfig;

export type McpAuthorizationResolverRequest = {
  server: string;
  resource: string;
  issuer: string;
  scopes: string[];
  authorizationUrl: string;
  state: string;
};

export class McpOAuthSecret {
  #value: string;

  constructor(value: string) {
    if (value.length === 0) {
      throw new Error("OAuth secret value must be non-empty");
    }
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }

  [Symbol.toPrimitive](): string {
    return "[redacted]";
  }
}

export function mcpOAuthSecret(value: string): McpOAuthSecret {
  return new McpOAuthSecret(value);
}

export type McpAuthorizationResolverResult = {
  callbackUrl: McpOAuthSecret;
};

export type McpAuthorizationResolver = (
  request: McpAuthorizationResolverRequest,
) => Promise<McpAuthorizationResolverResult>;

export type McpClientTransportConfig =
  | McpStdioClientTransportConfig
  | McpStreamableHttpClientTransportConfig;

export type NormalizedMcpClientTransport =
  | (McpStdioClientTransportConfig & { type: "stdio" })
  | (McpStreamableHttpClientTransportConfig & {
      authorization?: NormalizedMcpStreamableHttpAuthorizationConfig;
    });

export class McpConnectionError extends Error {
  readonly name = "McpConnectionError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    message: string,
  ) {
    super(`MCP connection error for server "${serverName}" during ${method}: ${message}`);
  }
}

export type McpAuthorizationChallenge = {
  scheme: "Bearer";
  resourceMetadataUrl?: string;
  metadataDiscovery?: McpProtectedResourceMetadataDiscovery;
  scopes: string[];
  error?: string;
};

export type McpProtectedResourceMetadata = {
  resource: string;
  authorizationServers: string[];
  bearerMethodsSupported: string[];
  scopesSupported: string[];
};

export type McpProtectedResourceMetadataDiscovery =
  | {
      status: "found";
      url: string;
      metadata: McpProtectedResourceMetadata;
    }
  | {
      status: "unavailable";
      attemptedUrls: string[];
      error: string;
    };

export type NormalizedMcpOAuthRegisteredClient = {
  kind: "registered";
  clientId: string;
  clientSecret?: string;
};

export type NormalizedMcpOAuthClientIdMetadataUrl = {
  kind: "client-id-metadata-url";
  clientId: string;
};

export type NormalizedMcpOAuthDynamicClient = {
  kind: "dynamic";
  clientName: string;
  dynamicClientRegistration: { enabled: true };
};

export type NormalizedMcpOAuthClientIdentity =
  | NormalizedMcpOAuthRegisteredClient
  | NormalizedMcpOAuthClientIdMetadataUrl
  | NormalizedMcpOAuthDynamicClient;

export type NormalizedMcpOAuthAuthorizationCodeConfig = {
  type: "oauth";
  issuer: string;
  redirectUri: string;
  scopes: string[];
  client: NormalizedMcpOAuthClientIdentity;
};

export type NormalizedMcpOAuthClientCredentialsClient = {
  kind: "registered";
  clientId: string;
  clientSecret: string;
};

export type NormalizedMcpOAuthClientCredentialsAuthorizationConfig = {
  type: "oauth-client-credentials";
  issuer: string;
  scopes: string[];
  tokenEndpointAuthMethod: McpOAuthClientCredentialsTokenEndpointAuthMethod;
  client: NormalizedMcpOAuthClientCredentialsClient;
};

export type NormalizedMcpStreamableHttpAuthorizationConfig =
  | NormalizedMcpOAuthAuthorizationCodeConfig
  | NormalizedMcpOAuthClientCredentialsAuthorizationConfig;

export type McpAuthorizationServerMetadata = {
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
  codeChallengeMethodsSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
  authorizationResponseIssuerRequired: boolean;
};

export type McpOAuthResolvedClient = {
  clientId: string;
  clientSecret?: string;
};

export type McpOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAtMs?: number;
};

export type McpOAuthTokenBinding = {
  resource: string;
  issuer: string;
  token: McpOAuthTokenSet;
};

export class McpAuthorizationError extends Error {
  readonly name = "McpAuthorizationError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    readonly status: 401 | 403,
    readonly challenge: McpAuthorizationChallenge,
  ) {
    const details: string[] = [];
    if (challenge.error) details.push(`error=${challenge.error}`);
    if (challenge.resourceMetadataUrl) {
      details.push(`resource_metadata=${challenge.resourceMetadataUrl}`);
    }
    if (challenge.scopes.length > 0) {
      details.push(`scope=${challenge.scopes.join(" ")}`);
    }
    if (challenge.metadataDiscovery?.status === "found") {
      const { authorizationServers } = challenge.metadataDiscovery.metadata;
      if (authorizationServers.length > 0) {
        details.push(`authorization_servers=${authorizationServers.join(" ")}`);
      }
    }
    const reason = status === 403
      ? "insufficient authorization scope"
      : "authorization required";
    super(
      `MCP authorization failed for server "${serverName}" during ${method}: ` +
        `HTTP ${status} ${reason}${details.length > 0 ? ` (${details.join("; ")})` : ""}`,
    );
  }
}

export class McpAuthorizationFlowError extends Error {
  readonly name = "McpAuthorizationFlowError";

  constructor(
    readonly serverName: string,
    readonly resource: string,
    readonly issuer: string,
    readonly scopes: readonly string[],
    reason: string,
  ) {
    super(
      `MCP authorization flow failed for server "${serverName}" ` +
        `resource "${resource}" issuer "${issuer}" scopes="${scopes.join(" ")}": ${reason}`,
    );
  }
}

export class McpToolError extends Error {
  readonly name = "McpToolError";

  constructor(
    readonly serverName: string,
    readonly method: string,
    message: string,
  ) {
    super(`MCP tool error for server "${serverName}" during ${method}: ${message}`);
  }
}
