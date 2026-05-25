import type {
  McpAuthorizationFlowError,
  McpAuthorizationServerMetadata,
  McpOAuthResolvedClient,
  McpOAuthTokenBinding,
  McpOAuthTokenSet,
  NormalizedMcpStreamableHttpAuthorizationConfig,
} from "./client-auth-types.js";
import {
  authorizationServerMetadataUrls,
  clientSecretBasicAuthorizationHeader,
  decodeAuthorizationServerMetadata,
  decodeOAuthTokenSet,
  normalizeHttpUrl,
  scopeSetIncludesAll,
  scopesNotIncluded,
} from "./client-authorization-protocol.js";
import {
  optionalString,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
import {
  createPrivateKeyJwtClientAssertion,
  MCP_PRIVATE_KEY_JWT_CLIENT_ASSERTION_TYPE,
} from "./client-oauth-private-key-jwt.js";
import { McpClientProtectedResourceRuntime } from "./client-protected-resource-runtime.js";
import type { JsonRpcResult } from "./client-protocol.js";
import { CONNECT_TIMEOUT } from "./client-protocol.js";

export abstract class McpClientOAuthTokenRuntime extends McpClientProtectedResourceRuntime {
  protected abstract authorizationFlowError(
    resource: string,
    issuer: string,
    scopes: readonly string[],
    reason: string,
  ): McpAuthorizationFlowError;

  protected async fetchAuthorizationServerMetadata(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpAuthorizationServerMetadata> {
    const errors: string[] = [];
    for (const url of authorizationServerMetadataUrls(config.issuer)) {
      let response: JsonRpcResult;
      try {
        response = await this.fetchOAuthJson(
          url,
          { method: "GET", headers: { Accept: "application/json" } },
          resource,
          config.issuer,
          scopes,
          `authorization-server metadata discovery at ${url}`,
        );
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        continue;
      }

      let metadata: McpAuthorizationServerMetadata;
      try {
        metadata = decodeAuthorizationServerMetadata(response);
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (metadata.issuer !== config.issuer) {
        errors.push(
          `${url}: authorization-server metadata issuer mismatch: expected "${config.issuer}"`,
        );
        continue;
      }
      const normalizedMetadata = {
        ...metadata,
        tokenEndpoint: normalizeHttpUrl(metadata.tokenEndpoint, "token_endpoint"),
        ...(metadata.authorizationEndpoint !== undefined
          ? {
              authorizationEndpoint: normalizeHttpUrl(
                metadata.authorizationEndpoint,
                "authorization_endpoint",
              ),
            }
          : {}),
        ...(metadata.registrationEndpoint !== undefined
          ? {
              registrationEndpoint: normalizeHttpUrl(
                metadata.registrationEndpoint,
                "registration_endpoint",
              ),
            }
          : {}),
      };

      if (config.type === "oauth") {
        if (normalizedMetadata.authorizationEndpoint === undefined) {
          errors.push(`${url}: authorization server does not advertise authorization_endpoint`);
          continue;
        }
        if (!normalizedMetadata.codeChallengeMethodsSupported.includes("S256")) {
          errors.push(`${url}: authorization server does not support PKCE S256`);
          continue;
        }
        return normalizedMetadata;
      }

      if (
        !normalizedMetadata.tokenEndpointAuthMethodsSupported.includes(
          config.tokenEndpointAuthMethod,
        )
      ) {
        errors.push(
          `${url}: authorization server does not advertise token endpoint auth method ${config.tokenEndpointAuthMethod}`,
        );
        continue;
      }
      if (normalizedMetadata.scopesSupported.length > 0) {
        const unsupportedScopes = scopesNotIncluded(
          scopes,
          normalizedMetadata.scopesSupported,
        );
        if (unsupportedScopes.length > 0) {
          errors.push(
            `${url}: authorization server does not advertise configured scope${unsupportedScopes.length === 1 ? "" : "s"} ${unsupportedScopes.join(" ")}`,
          );
          continue;
        }
      }
      return normalizedMetadata;
    }

    throw this.authorizationFlowError(
      resource,
      config.issuer,
      scopes,
      `authorization-server metadata discovery failed: ${errors.join("; ")}`,
    );
  }

  protected async resolveOAuthClient(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    metadata: McpAuthorizationServerMetadata,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthResolvedClient> {
    const cacheKey = `${resource}\n${config.issuer}`;
    const cached = this.oauthClients.get(cacheKey);
    if (cached) return cached;

    if (config.type === "oauth-client-credentials") {
      const client = {
        clientId: config.client.clientId,
        ...(config.tokenEndpointAuthMethod === "client_secret_basic"
          ? { clientSecret: config.client.clientSecret }
          : { privateKeyJwt: config.client }),
      };
      this.oauthClients.set(cacheKey, client);
      return client;
    }

    if (config.client.kind === "registered") {
      const client = {
        clientId: config.client.clientId,
        ...(config.client.clientSecret !== undefined
          ? { clientSecret: config.client.clientSecret }
          : {}),
      };
      this.oauthClients.set(cacheKey, client);
      return client;
    }
    if (config.client.kind === "client-id-metadata-url") {
      const client = { clientId: config.client.clientId };
      this.oauthClients.set(cacheKey, client);
      return client;
    }
    if (!metadata.registrationEndpoint) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "authorization server does not advertise dynamic client registration",
      );
    }

    const registration = await this.fetchOAuthJson(
      metadata.registrationEndpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: config.client.clientName,
          redirect_uris: [config.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      },
      resource,
      config.issuer,
      scopes,
      "dynamic client registration",
    );
    const object = requireJsonObject(
      registration,
      "registration",
      "authorization-server-metadata",
    );
    const clientId = requireString(
      object.client_id,
      "client_id",
      "authorization-server-metadata",
    );
    const clientSecret = optionalString(
      object.client_secret,
      "client_secret",
      "authorization-server-metadata",
    );
    const client = {
      clientId,
      ...(clientSecret !== undefined ? { clientSecret } : {}),
    };
    this.oauthClients.set(cacheKey, client);
    return client;
  }

  protected async refreshExpiredOAuthTokenIfNeeded(): Promise<void> {
    if (this.transport.type !== "http" || !this.transport.authorization) return;
    const binding = this.oauthTokenBinding;
    if (!binding || binding.token.expiresAtMs === undefined) return;
    if (Date.now() < binding.token.expiresAtMs) return;

    const config = this.transport.authorization;
    const scopes = config.type === "oauth-client-credentials"
      ? config.scopes
      : binding.token.scopes.length > 0
      ? binding.token.scopes
      : config.scopes;
    const metadata = await this.fetchAuthorizationServerMetadata(
      config,
      binding.resource,
      scopes,
    );
    const client = await this.resolveOAuthClient(
      config,
      metadata,
      binding.resource,
      scopes,
    );
    if (config.type === "oauth-client-credentials") {
      const token = await this.runClientCredentialsFlow(
        metadata,
        config,
        client,
        binding.resource,
        scopes,
      );
      const tokenWithScopes = token.scopes.length > 0
        ? token
        : { ...token, scopes: [...scopes] };
      if (!scopeSetIncludesAll(tokenWithScopes.scopes, scopes)) {
        throw this.authorizationFlowError(
          binding.resource,
          config.issuer,
          scopes,
          "client credentials token did not grant the required scopes",
        );
      }
      this.oauthTokenBinding = {
        resource: binding.resource,
        issuer: binding.issuer,
        token: tokenWithScopes,
      };
      return;
    }
    if (!binding.token.refreshToken) return;
    const refreshed = await this.refreshOAuthToken(
      metadata,
      config,
      client,
      binding,
      scopes,
    );
    this.oauthTokenBinding = {
      resource: binding.resource,
      issuer: binding.issuer,
      token: refreshed.scopes.length > 0
        ? refreshed
        : { ...refreshed, scopes: binding.token.scopes },
    };
  }

  protected async runClientCredentialsFlow(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    if (config.type !== "oauth-client-credentials") {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "client credentials flow requires client-credentials authorization config",
      );
    }
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      resource,
      scope: scopes.join(" "),
    });
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (config.tokenEndpointAuthMethod === "client_secret_basic") {
      if (client.clientSecret === undefined) {
        throw this.authorizationFlowError(
          resource,
          config.issuer,
          scopes,
          "client credentials flow requires a configured client secret",
        );
      }
      headers.Authorization = clientSecretBasicAuthorizationHeader(
        client.clientId,
        client.clientSecret,
      );
    } else {
      if (client.privateKeyJwt === undefined) {
        throw this.authorizationFlowError(
          resource,
          config.issuer,
          scopes,
          "client credentials flow requires a configured private_key_jwt signing key",
        );
      }
      let assertion: string;
      try {
        assertion = createPrivateKeyJwtClientAssertion(
          client.privateKeyJwt,
          metadata.tokenEndpoint,
        );
      } catch (err) {
        throw this.authorizationFlowError(
          resource,
          config.issuer,
          scopes,
          err instanceof Error ? err.message : String(err),
        );
      }
      this.oauthClientAssertions.add(assertion);
      form.set("client_id", client.clientId);
      form.set("client_assertion_type", MCP_PRIVATE_KEY_JWT_CLIENT_ASSERTION_TYPE);
      form.set("client_assertion", assertion);
    }
    const tokenJson = await this.fetchOAuthJson(
      metadata.tokenEndpoint,
      {
        method: "POST",
        headers,
        body: form.toString(),
      },
      resource,
      config.issuer,
      scopes,
      "token endpoint",
    );
    return decodeOAuthTokenSet(tokenJson);
  }

  protected async refreshOAuthToken(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    client: McpOAuthResolvedClient,
    binding: McpOAuthTokenBinding,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    if (!binding.token.refreshToken) return binding.token;
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: binding.token.refreshToken,
      client_id: client.clientId,
      resource: binding.resource,
      scope: scopes.join(" "),
    });
    if (client.clientSecret !== undefined) {
      form.set("client_secret", client.clientSecret);
    }
    const tokenJson = await this.fetchOAuthJson(
      metadata.tokenEndpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      binding.resource,
      config.issuer,
      scopes,
      "token endpoint",
    );
    return decodeOAuthTokenSet(tokenJson, binding.token.refreshToken);
  }

  protected async fetchOAuthJson(
    url: string,
    init: RequestInit,
    resource: string,
    issuer: string,
    scopes: readonly string[],
    label: string,
  ): Promise<JsonRpcResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const message = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${CONNECT_TIMEOUT}ms`
        : err instanceof Error ? err.message : String(err);
      throw this.authorizationFlowError(resource, issuer, scopes, `${label} failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw this.authorizationFlowError(
        resource,
        issuer,
        scopes,
        `${label} failed: HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw this.authorizationFlowError(
        resource,
        issuer,
        scopes,
        `${label} failed: unsupported response content-type "${contentType || "(missing)"}"`,
      );
    }
    try {
      return JSON.parse(await response.text()) as JsonRpcResult;
    } catch {
      throw this.authorizationFlowError(resource, issuer, scopes, `${label} returned malformed JSON`);
    }
  }
}
