import { OUTBOUND_HTTP_PROFILES, outboundHttp } from "#core/outbound-http/index.js";
import type {
  McpAuthorizationChallenge,
  McpProtectedResourceMetadataDiscovery,
} from "./client-auth-types.js";
import {
  decodeProtectedResourceMetadata,
  protectedResourceMetadataWellKnownUrls,
} from "./client-authorization-protocol.js";
import { McpClientNotifications } from "./client-notifications.js";
import type { JsonRpcResult } from "./client-protocol.js";
import { CONNECT_TIMEOUT } from "./client-protocol.js";
import {
  MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
  McpResponseBodyLimitError,
  readMcpResponseTextWithLimit,
} from "./client-response-body-limit.js";

export abstract class McpClientProtectedResourceRuntime extends McpClientNotifications {
  protected async challengeWithProtectedResourceMetadata(
    challenge: McpAuthorizationChallenge,
  ): Promise<McpAuthorizationChallenge> {
    if (this.transport.type !== "http") return challenge;
    const metadataDiscovery = await this.discoverProtectedResourceMetadata(
      challenge.resourceMetadataUrl,
    );
    return {
      ...challenge,
      ...(metadataDiscovery.status === "found"
        ? { resourceMetadataUrl: metadataDiscovery.url }
        : {}),
      metadataDiscovery,
    };
  }

  protected async discoverProtectedResourceMetadata(
    challengeResourceMetadataUrl: string | undefined,
  ): Promise<McpProtectedResourceMetadataDiscovery> {
    let candidateUrls: string[];
    try {
      candidateUrls = this.protectedResourceMetadataCandidateUrls(
        challengeResourceMetadataUrl,
      );
    } catch (err) {
      return {
        status: "unavailable",
        attemptedUrls: challengeResourceMetadataUrl ? [challengeResourceMetadataUrl] : [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const errors: string[] = [];
    for (const url of candidateUrls) {
      const result = await this.fetchProtectedResourceMetadata(url);
      if (result.status === "found") return result;
      errors.push(result.error);
    }

    return {
      status: "unavailable",
      attemptedUrls: candidateUrls,
      error: errors.join("; ") || "no protected-resource metadata URL available",
    };
  }

  protected protectedResourceMetadataCandidateUrls(
    challengeResourceMetadataUrl: string | undefined,
  ): string[] {
    if (this.transport.type !== "http") return [];
    if (challengeResourceMetadataUrl === undefined) {
      return protectedResourceMetadataWellKnownUrls(this.transport.url);
    }

    const metadataUrl = new URL(challengeResourceMetadataUrl);
    if (metadataUrl.protocol !== "http:" && metadataUrl.protocol !== "https:") {
      throw new Error("resource_metadata URL must use http or https");
    }
    const resourceUrl = new URL(this.transport.url);
    if (metadataUrl.origin !== resourceUrl.origin) {
      throw new Error("resource_metadata URL must use the MCP HTTP origin");
    }
    return [metadataUrl.toString()];
  }

  protected async fetchProtectedResourceMetadata(
    url: string,
  ): Promise<McpProtectedResourceMetadataDiscovery> {
    if (this.transport.type !== "http") {
      throw new Error(`MCP server "${this.serverName}" is not an HTTP transport`);
    }
    const transport = this.transport;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    try {
      let response: Response;
      try {
        ({ response } = await outboundHttp.requestStream({
          profile: OUTBOUND_HTTP_PROFILES.oauthProtectedResource([transport.url]),
          operation: "mcp.protected-resource-metadata",
          url,
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
          limits: {
            timeoutMs: CONNECT_TIMEOUT,
            responseBytes: MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
          },
        }));
      } catch (err) {
        const message = controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
          ? `request timed out after ${CONNECT_TIMEOUT}ms`
          : err instanceof Error ? err.message : String(err);
        return {
          status: "unavailable",
          attemptedUrls: [url],
          error: `${url}: ${message}`,
        };
      }

      if (!response.ok) {
        return {
          status: "unavailable",
          attemptedUrls: [url],
          error: `${url}: HTTP ${response.status}`,
        };
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        return {
          status: "unavailable",
          attemptedUrls: [url],
          error: `${url}: unsupported response content-type "${contentType || "(missing)"}"`,
        };
      }

      let parsed: JsonRpcResult;
      try {
        const text = await readMcpResponseTextWithLimit(
          response,
          MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
          "MCP protected-resource metadata response",
        );
        parsed = JSON.parse(text) as JsonRpcResult;
        return {
          status: "found",
          url,
          metadata: decodeProtectedResourceMetadata(parsed),
        };
      } catch (err) {
        if (err instanceof McpResponseBodyLimitError) {
          return {
            status: "unavailable",
            attemptedUrls: [url],
            error: `${url}: ${err.message}`,
          };
        }
        if (err instanceof Error && err.name === "AbortError") {
          return {
            status: "unavailable",
            attemptedUrls: [url],
            error: `${url}: request timed out after ${CONNECT_TIMEOUT}ms`,
          };
        }
        return {
          status: "unavailable",
          attemptedUrls: [url],
          error: `${url}: malformed protected-resource metadata: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
