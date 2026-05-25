import { Buffer } from "node:buffer";
import type {
  McpAuthorizationFlowError,
  McpAuthorizationServerMetadata,
  McpEnterpriseManagedIdJagTokenSet,
  McpOAuthResolvedClient,
  McpOAuthTokenBinding,
  McpOAuthTokenSet,
  NormalizedMcpEnterpriseManagedAuthorizationConfig,
  NormalizedMcpStreamableHttpAuthorizationConfig,
} from "./client-auth-types.js";
import {
  authorizationServerMetadataUrls,
  clientSecretBasicAuthorizationHeader,
  decodeAuthorizationServerMetadata,
  decodeEnterpriseManagedIdJagTokenSet,
  decodeOAuthTokenSet,
  MCP_ENTERPRISE_ID_JAG_JWT_TYPE,
  MCP_ENTERPRISE_ID_JAG_TOKEN_TYPE,
  MCP_ENTERPRISE_JWT_BEARER_GRANT_TYPE,
  MCP_ENTERPRISE_TOKEN_EXCHANGE_GRANT_TYPE,
  normalizeHttpUrl,
  scopeSetIncludesAll,
  scopesNotIncluded,
  splitScopeParam,
} from "./client-authorization-protocol.js";
import {
  optionalNumber,
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
      const normalizedMetadata = this.normalizeAuthorizationServerMetadataEndpoints(
        metadata,
      );

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

  protected async fetchEnterpriseManagedIdentityProviderMetadata(
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpAuthorizationServerMetadata> {
    const errors: string[] = [];
    for (const url of authorizationServerMetadataUrls(config.identityProvider.issuer)) {
      let response: JsonRpcResult;
      try {
        response = await this.fetchOAuthJson(
          url,
          { method: "GET", headers: { Accept: "application/json" } },
          resource,
          config.issuer,
          scopes,
          `enterprise-managed identity-provider metadata discovery at ${url}`,
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
      if (metadata.issuer !== config.identityProvider.issuer) {
        errors.push(
          `${url}: identity-provider metadata issuer mismatch: expected "${config.identityProvider.issuer}"`,
        );
        continue;
      }

      let normalizedMetadata: McpAuthorizationServerMetadata;
      try {
        normalizedMetadata = this.normalizeAuthorizationServerMetadataEndpoints(
          metadata,
        );
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (normalizedMetadata.tokenEndpoint !== config.identityProvider.tokenEndpoint) {
        errors.push(
          `${url}: identity-provider metadata token_endpoint does not match configured identityProvider.tokenEndpoint "${config.identityProvider.tokenEndpoint}"`,
        );
        continue;
      }
      if (
        !normalizedMetadata.tokenEndpointAuthMethodsSupported.includes(
          config.tokenEndpointAuthMethod,
        )
      ) {
        errors.push(
          `${url}: identity provider does not advertise token endpoint auth method ${config.tokenEndpointAuthMethod}`,
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
            `${url}: identity provider does not advertise configured scope${unsupportedScopes.length === 1 ? "" : "s"} ${unsupportedScopes.join(" ")}`,
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
      `enterprise-managed identity-provider metadata discovery failed: ${errors.join("; ")}`,
    );
  }

  protected normalizeAuthorizationServerMetadataEndpoints(
    metadata: McpAuthorizationServerMetadata,
  ): McpAuthorizationServerMetadata {
    return {
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

    if (config.type === "oauth-client-credentials" || config.type === "enterprise-managed") {
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
    const scopes = config.type === "oauth-client-credentials" || config.type === "enterprise-managed"
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
    if (config.type === "enterprise-managed") {
      const token = await this.runEnterpriseManagedAuthorizationFlow(
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
          "enterprise-managed access token did not grant the required scopes",
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
    this.applyRegisteredClientAuthentication(
      headers,
      form,
      config,
      client,
      metadata.tokenEndpoint,
      resource,
      scopes,
      "client credentials flow",
    );
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

  protected async runEnterpriseManagedAuthorizationFlow(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    const identityProviderMetadata = await this.fetchEnterpriseManagedIdentityProviderMetadata(
      config,
      resource,
      scopes,
    );
    const idJag = await this.runEnterpriseManagedIdJagExchange(
      identityProviderMetadata,
      config,
      client,
      resource,
      scopes,
    );
    const idJagWithScopes = idJag.scopes.length > 0
      ? idJag
      : { ...idJag, scopes: [...scopes] };
    if (!scopeSetIncludesAll(idJagWithScopes.scopes, scopes)) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG did not grant the required scopes",
      );
    }
    this.validateEnterpriseManagedIdJag(idJag.idJag, config, client, resource, scopes);

    const form = new URLSearchParams({
      grant_type: MCP_ENTERPRISE_JWT_BEARER_GRANT_TYPE,
      assertion: idJag.idJag,
    });
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    this.applyRegisteredClientAuthentication(
      headers,
      form,
      config,
      client,
      metadata.tokenEndpoint,
      resource,
      scopes,
      "enterprise-managed JWT bearer grant",
    );
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
      "enterprise-managed JWT bearer grant",
    );
    return decodeOAuthTokenSet(tokenJson);
  }

  protected async runEnterpriseManagedIdJagExchange(
    identityProviderMetadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpEnterpriseManagedIdJagTokenSet> {
    const subjectToken = this.resolveEnterpriseManagedSubjectToken(
      config,
      resource,
      scopes,
    );
    const form = new URLSearchParams({
      grant_type: MCP_ENTERPRISE_TOKEN_EXCHANGE_GRANT_TYPE,
      requested_token_type: MCP_ENTERPRISE_ID_JAG_TOKEN_TYPE,
      audience: config.issuer,
      resource,
      scope: scopes.join(" "),
      subject_token: subjectToken,
      subject_token_type: config.subjectToken.tokenType,
    });
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    this.applyRegisteredClientAuthentication(
      headers,
      form,
      config,
      client,
      identityProviderMetadata.tokenEndpoint,
      resource,
      scopes,
      "enterprise-managed token exchange",
    );
    const tokenJson = await this.fetchOAuthJson(
      identityProviderMetadata.tokenEndpoint,
      {
        method: "POST",
        headers,
        body: form.toString(),
      },
      resource,
      config.issuer,
      scopes,
      "enterprise-managed token exchange",
    );
    const idJag = decodeEnterpriseManagedIdJagTokenSet(tokenJson);
    this.oauthClientAssertions.add(idJag.idJag);
    return idJag;
  }

  protected applyRegisteredClientAuthentication(
    headers: Record<string, string>,
    form: URLSearchParams,
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
    client: McpOAuthResolvedClient,
    tokenEndpoint: string,
    resource: string,
    scopes: readonly string[],
    label: string,
  ): void {
    if (config.type === "oauth") {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `${label} requires registered client authentication config`,
      );
    }
    if (config.tokenEndpointAuthMethod === "client_secret_basic") {
      if (client.clientSecret === undefined) {
        throw this.authorizationFlowError(
          resource,
          config.issuer,
          scopes,
          `${label} requires a configured client secret`,
        );
      }
      headers.Authorization = clientSecretBasicAuthorizationHeader(
        client.clientId,
        client.clientSecret,
      );
      return;
    }
    if (client.privateKeyJwt === undefined) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `${label} requires a configured private_key_jwt signing key`,
      );
    }
    let assertion: string;
    try {
      assertion = createPrivateKeyJwtClientAssertion(client.privateKeyJwt, tokenEndpoint);
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

  protected resolveEnterpriseManagedSubjectToken(
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    resource: string,
    scopes: readonly string[],
  ): string {
    const source = config.subjectToken.source;
    if (source.kind === "static") {
      this.oauthClientAssertions.add(source.token);
      return source.token;
    }
    const value = process.env[source.name];
    if (value === undefined || value.length === 0) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `enterprise-managed subject token env source "${source.name}" is unset`,
      );
    }
    this.oauthClientAssertions.add(value);
    return value;
  }

  protected validateEnterpriseManagedIdJag(
    idJag: string,
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): void {
    const decoded = this.decodeEnterpriseManagedJwt(idJag, config, resource, scopes);
    const typ = requireString(decoded.header.typ, "typ", "oauth-token");
    if (typ !== MCP_ENTERPRISE_ID_JAG_JWT_TYPE) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `enterprise-managed ID-JAG JWT typ must be ${MCP_ENTERPRISE_ID_JAG_JWT_TYPE}`,
      );
    }
    const issuer = requireString(decoded.payload.iss, "iss", "oauth-token");
    if (issuer !== config.identityProvider.issuer) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG issuer did not match the configured identity provider",
      );
    }
    requireString(decoded.payload.sub, "sub", "oauth-token");
    const audience = requireString(decoded.payload.aud, "aud", "oauth-token");
    if (audience !== config.issuer) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG audience did not match the selected authorization server",
      );
    }
    const tokenResource = requireString(decoded.payload.resource, "resource", "oauth-token");
    if (tokenResource !== resource) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG resource did not match the protected resource",
      );
    }
    const tokenClientId = requireString(decoded.payload.client_id, "client_id", "oauth-token");
    if (tokenClientId !== client.clientId) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG client_id did not match the authenticated client",
      );
    }
    requireString(decoded.payload.jti, "jti", "oauth-token");
    const issuedAt = optionalNumber(decoded.payload.iat, "iat", "oauth-token");
    if (issuedAt === undefined) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG iat must be a number",
      );
    }
    const expiresAt = optionalNumber(decoded.payload.exp, "exp", "oauth-token");
    if (expiresAt === undefined) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG exp must be a number",
      );
    }
    if (expiresAt <= Date.now() / 1000) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG is expired",
      );
    }
    const tokenScope = optionalString(decoded.payload.scope, "scope", "oauth-token");
    if (tokenScope !== undefined && !scopeSetIncludesAll(splitScopeParam(tokenScope), scopes)) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG scope did not grant the required scopes",
      );
    }
  }

  protected decodeEnterpriseManagedJwt(
    jwt: string,
    config: NormalizedMcpEnterpriseManagedAuthorizationConfig,
    resource: string,
    scopes: readonly string[],
  ): {
    header: ReturnType<typeof requireJsonObject>;
    payload: ReturnType<typeof requireJsonObject>;
  } {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "enterprise-managed ID-JAG must be a compact JWT",
      );
    }
    const [encodedHeader, encodedPayload] = parts as [string, string, string];
    try {
      return {
        header: requireJsonObject(
          JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")),
          "header",
          "oauth-token",
        ),
        payload: requireJsonObject(
          JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
          "payload",
          "oauth-token",
        ),
      };
    } catch (err) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `enterprise-managed ID-JAG is malformed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
