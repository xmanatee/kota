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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${CONNECT_TIMEOUT}ms`
        : err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: ${message}`,
      };
    } finally {
      clearTimeout(timer);
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
      parsed = JSON.parse(await response.text()) as JsonRpcResult;
      return {
        status: "found",
        url,
        metadata: decodeProtectedResourceMetadata(parsed),
      };
    } catch (err) {
      return {
        status: "unavailable",
        attemptedUrls: [url],
        error: `${url}: malformed protected-resource metadata: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }
}
