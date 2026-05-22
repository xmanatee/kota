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
  decodeAuthorizationServerMetadata,
  decodeOAuthTokenSet,
  normalizeHttpUrl,
} from "./client-authorization-protocol.js";
import {
  optionalString,
  requireJsonObject,
  requireString,
} from "./client-decode-utils.js";
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
      if (!metadata.codeChallengeMethodsSupported.includes("S256")) {
        errors.push(`${url}: authorization server does not support PKCE S256`);
        continue;
      }
      return {
        ...metadata,
        authorizationEndpoint: normalizeHttpUrl(
          metadata.authorizationEndpoint,
          "authorization_endpoint",
        ),
        tokenEndpoint: normalizeHttpUrl(metadata.tokenEndpoint, "token_endpoint"),
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
    if (!binding?.token.refreshToken || binding.token.expiresAtMs === undefined) return;
    if (Date.now() < binding.token.expiresAtMs) return;

    const config = this.transport.authorization;
    const scopes = binding.token.scopes.length > 0
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw this.authorizationFlowError(resource, issuer, scopes, `${label} returned malformed JSON: ${message}`);
    }
  }
}
