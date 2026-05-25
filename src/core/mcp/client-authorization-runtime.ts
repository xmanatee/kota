import { createHash } from "node:crypto";
import type {
  McpAuthorizationServerMetadata,
  McpOAuthResolvedClient,
  McpOAuthTokenSet,
  McpProtectedResourceMetadata,
  NormalizedMcpOAuthAuthorizationCodeConfig,
  NormalizedMcpOAuthClientCredentialsAuthorizationConfig,
} from "./client-auth-types.js";
import {
  McpAuthorizationError,
  McpAuthorizationFlowError,
} from "./client-auth-types.js";
import {
  base64Url,
  decodeOAuthTokenSet,
  generateOAuthState,
  generateOAuthVerifier,
  normalizeHttpUrl,
  parseWwwAuthenticateChallenge,
  scopeSetIncludesAll,
  scopesNotIncluded,
  uniqueScopes,
} from "./client-authorization-protocol.js";
import { McpClientOAuthTokenRuntime } from "./client-oauth-token-runtime.js";

export abstract class McpClientAuthorizationRuntime extends McpClientOAuthTokenRuntime {
  protected async authorizationErrorForHttpResponse(
    response: Response,
    method: string,
  ): Promise<McpAuthorizationError | null> {
    if (response.status !== 401 && response.status !== 403) return null;
    const parsedChallenge = parseWwwAuthenticateChallenge(
      response.headers.get("www-authenticate"),
    ) ?? { scheme: "Bearer" as const, scopes: [] };
    const challenge = await this.challengeWithProtectedResourceMetadata(parsedChallenge);
    return new McpAuthorizationError(
      this.serverName,
      method,
      response.status,
      challenge,
    );
  }

  protected async authorizeForHttpChallenge(
    error: McpAuthorizationError,
  ): Promise<boolean> {
    if (this.transport.type !== "http" || !this.transport.authorization) {
      return false;
    }
    const config = this.transport.authorization;
    const challenge = error.challenge;
    const configuredScopes = config.scopes;
    const challengeErrorScopes = config.type === "oauth-client-credentials"
      ? configuredScopes
      : uniqueScopes([...configuredScopes, ...challenge.scopes]);
    if (challenge.metadataDiscovery?.status !== "found") {
      const resource = this.oauthTokenBinding?.resource ?? this.transport.url;
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        challengeErrorScopes,
        `protected-resource metadata unavailable: ${
          challenge.metadataDiscovery?.error ?? "no protected-resource metadata"
        }`,
      );
    }

    const resourceMetadata = challenge.metadataDiscovery.metadata;
    if (!resourceMetadata.authorizationServers.includes(config.issuer)) {
      throw this.authorizationFlowError(
        resourceMetadata.resource,
        config.issuer,
        challengeErrorScopes,
        `issuer "${config.issuer}" is not advertised by protected resource metadata`,
      );
    }

    const resource = config.type === "oauth-client-credentials"
      ? this.validateClientCredentialsProtectedResourceMetadata(
          config,
          resourceMetadata,
          challenge.scopes,
          this.transport.url,
        )
      : resourceMetadata.resource;
    const requestedScopes = config.type === "oauth-client-credentials"
      ? [...configuredScopes]
      : uniqueScopes([
          ...configuredScopes,
          ...(challenge.error === "insufficient_scope" && this.oauthTokenBinding
            ? this.oauthTokenBinding.token.scopes
            : []),
          ...challenge.scopes,
        ]);
    const metadata = await this.fetchAuthorizationServerMetadata(
      config,
      resource,
      requestedScopes,
    );
    const client = await this.resolveOAuthClient(
      config,
      metadata,
      resource,
      requestedScopes,
    );
    const rawToken = config.type === "oauth-client-credentials"
      ? await this.runClientCredentialsFlow(
          metadata,
          config,
          client,
          resource,
          requestedScopes,
        )
      : await this.runAuthorizationCodeFlow(
          config,
          metadata,
          client,
          resource,
          requestedScopes,
        );
    const token = rawToken.scopes.length > 0
      ? rawToken
      : { ...rawToken, scopes: [...requestedScopes] };
    if (!scopeSetIncludesAll(token.scopes, requestedScopes)) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        requestedScopes,
        "authorization token did not grant the required scopes",
      );
    }
    this.oauthTokenBinding = {
      resource,
      issuer: config.issuer,
      token,
    };
    return true;
  }

  protected validateClientCredentialsProtectedResourceMetadata(
    config: NormalizedMcpOAuthClientCredentialsAuthorizationConfig,
    resourceMetadata: McpProtectedResourceMetadata,
    challengeScopes: readonly string[],
    configuredResource: string,
  ): string {
    let normalizedResource: string;
    try {
      normalizedResource = normalizeHttpUrl(
        resourceMetadata.resource,
        "protected-resource metadata resource",
      );
    } catch (err) {
      throw this.authorizationFlowError(
        resourceMetadata.resource,
        config.issuer,
        config.scopes,
        `protected-resource metadata resource is invalid: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (normalizedResource !== configuredResource) {
      throw this.authorizationFlowError(
        normalizedResource,
        config.issuer,
        config.scopes,
        `protected-resource metadata resource does not match configured MCP HTTP URL "${configuredResource}"`,
      );
    }

    const unsupportedChallengeScopes = scopesNotIncluded(
      challengeScopes,
      config.scopes,
    );
    if (unsupportedChallengeScopes.length > 0) {
      throw this.authorizationFlowError(
        normalizedResource,
        config.issuer,
        config.scopes,
        `challenge requested scope${unsupportedChallengeScopes.length === 1 ? "" : "s"} outside configured client credentials scopes: ${unsupportedChallengeScopes.join(" ")}`,
      );
    }

    if (resourceMetadata.scopesSupported.length > 0) {
      const unsupportedConfiguredScopes = scopesNotIncluded(
        config.scopes,
        resourceMetadata.scopesSupported,
      );
      if (unsupportedConfiguredScopes.length > 0) {
        throw this.authorizationFlowError(
          normalizedResource,
          config.issuer,
          config.scopes,
          `protected-resource metadata does not advertise configured scope${unsupportedConfiguredScopes.length === 1 ? "" : "s"} ${unsupportedConfiguredScopes.join(" ")}`,
        );
      }
    }

    return normalizedResource;
  }

  protected authorizationFlowError(
    resource: string,
    issuer: string,
    scopes: readonly string[],
    reason: string,
  ): McpAuthorizationFlowError {
    const redactedReason = this.redactSensitiveErrorMessage(reason);
    return new McpAuthorizationFlowError(
      this.serverName,
      resource,
      issuer,
      scopes,
      redactedReason,
    );
  }

  protected async runAuthorizationCodeFlow(
    config: NormalizedMcpOAuthAuthorizationCodeConfig,
    metadata: McpAuthorizationServerMetadata,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
  ): Promise<McpOAuthTokenSet> {
    if (!this.authorizationResolver) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "interactive authorization is required but no MCP authorization resolver is configured; configure an operator authorization resolver or static headers for this server",
      );
    }

    const codeVerifier = generateOAuthVerifier();
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const state = generateOAuthState();
    if (metadata.authorizationEndpoint === undefined) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "authorization server does not advertise authorization_endpoint",
      );
    }
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", client.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("resource", resource);
    authorizationUrl.searchParams.set("scope", scopes.join(" "));
    authorizationUrl.searchParams.set("state", state);

    const callback = await this.authorizationResolver({
      server: this.serverName,
      resource,
      issuer: config.issuer,
      scopes: [...scopes],
      authorizationUrl: authorizationUrl.toString(),
      state,
    });
    const code = this.validateAuthorizationCallback(
      callback.callbackUrl.reveal(),
      config,
      metadata,
      resource,
      scopes,
      state,
    );
    const token = await this.exchangeAuthorizationCode(
      metadata,
      config,
      client,
      resource,
      scopes,
      code,
      codeVerifier,
    );
    return token.scopes.length > 0 ? token : { ...token, scopes: [...scopes] };
  }

  protected validateAuthorizationCallback(
    callbackUrl: string,
    config: NormalizedMcpOAuthAuthorizationCodeConfig,
    metadata: McpAuthorizationServerMetadata,
    resource: string,
    scopes: readonly string[],
    state: string,
  ): string {
    const callback = new URL(callbackUrl);
    const expectedRedirect = new URL(config.redirectUri);
    if (
      callback.origin !== expectedRedirect.origin ||
      callback.pathname !== expectedRedirect.pathname
    ) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback URL did not match the configured redirectUri",
      );
    }
    const returnedState = callback.searchParams.get("state");
    if (returnedState !== state) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback state did not match the authorization request",
      );
    }
    const callbackIssuer = callback.searchParams.get("iss");
    if (metadata.authorizationResponseIssuerRequired && callbackIssuer === null) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback issuer parameter is required by authorization-server metadata",
      );
    }
    if (callbackIssuer !== null && callbackIssuer !== config.issuer) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback issuer did not match the selected authorization server",
      );
    }
    const callbackError = callback.searchParams.get("error");
    if (callbackError !== null) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        `OAuth callback returned error "${callbackError}"`,
      );
    }
    const code = callback.searchParams.get("code");
    if (code === null || code.length === 0) {
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        scopes,
        "OAuth callback did not include an authorization code",
      );
    }
    return code;
  }

  protected async exchangeAuthorizationCode(
    metadata: McpAuthorizationServerMetadata,
    config: NormalizedMcpOAuthAuthorizationCodeConfig,
    client: McpOAuthResolvedClient,
    resource: string,
    scopes: readonly string[],
    code: string,
    codeVerifier: string,
  ): Promise<McpOAuthTokenSet> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: client.clientId,
      code_verifier: codeVerifier,
      resource,
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
      resource,
      config.issuer,
      scopes,
      "token endpoint",
    );
    return decodeOAuthTokenSet(tokenJson);
  }

}
