import { createHash } from "node:crypto";
import type {
  McpAuthorizationServerMetadata,
  McpOAuthResolvedClient,
  McpOAuthTokenSet,
  NormalizedMcpStreamableHttpAuthorizationConfig,
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
  parseWwwAuthenticateChallenge,
  scopeSetIncludesAll,
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
    if (challenge.metadataDiscovery?.status !== "found") {
      const resource = this.oauthTokenBinding?.resource ?? this.transport.url;
      throw this.authorizationFlowError(
        resource,
        config.issuer,
        uniqueScopes([...config.scopes, ...challenge.scopes]),
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
        uniqueScopes([...config.scopes, ...challenge.scopes]),
        `issuer "${config.issuer}" is not advertised by protected resource metadata`,
      );
    }

    const requestedScopes = uniqueScopes([
      ...config.scopes,
      ...(challenge.error === "insufficient_scope" && this.oauthTokenBinding
        ? this.oauthTokenBinding.token.scopes
        : []),
      ...challenge.scopes,
    ]);
    const metadata = await this.fetchAuthorizationServerMetadata(
      config,
      resourceMetadata.resource,
      requestedScopes,
    );
    const client = await this.resolveOAuthClient(
      config,
      metadata,
      resourceMetadata.resource,
      requestedScopes,
    );
    const token = await this.runAuthorizationCodeFlow(
      config,
      metadata,
      client,
      resourceMetadata.resource,
      requestedScopes,
    );
    if (!scopeSetIncludesAll(token.scopes, requestedScopes)) {
      throw this.authorizationFlowError(
        resourceMetadata.resource,
        config.issuer,
        requestedScopes,
        "authorization did not grant the required scopes",
      );
    }
    this.oauthTokenBinding = {
      resource: resourceMetadata.resource,
      issuer: config.issuer,
      token,
    };
    return true;
  }

  protected authorizationFlowError(
    resource: string,
    issuer: string,
    scopes: readonly string[],
    reason: string,
  ): McpAuthorizationFlowError {
    return new McpAuthorizationFlowError(
      this.serverName,
      resource,
      issuer,
      scopes,
      reason,
    );
  }

  protected async runAuthorizationCodeFlow(
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
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
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
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
    config: NormalizedMcpStreamableHttpAuthorizationConfig,
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
