import { afterEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import {
  createGoogleWorkspaceReadinessSource,
  GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
} from "./capability-readiness.js";

describe("Google Workspace capability readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports OAuth unavailable when configured secret references are missing", async () => {
    const source = createGoogleWorkspaceReadinessSource({
      getConfig: () => ({
        clientId: "$GOOGLE_CLIENT_ID",
        clientSecret: "$GOOGLE_CLIENT_SECRET",
        refreshToken: "$GOOGLE_REFRESH_TOKEN",
      }),
      getSecret: () => null,
    });

    await expect(source.probe()).resolves.toEqual([{
      id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
      moduleName: "google-workspace",
      status: "unavailable",
      reason: "oauth_secret_missing",
      message: "Google Workspace OAuth secret references are missing.",
    }]);
  });

  it("reports OAuth ready when token refresh succeeds", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "access-token", expires_in: 3600 }),
    });
    const source = createGoogleWorkspaceReadinessSource({
      getConfig: () => ({
        clientId: "$GOOGLE_CLIENT_ID",
        clientSecret: "$GOOGLE_CLIENT_SECRET",
        refreshToken: "$GOOGLE_REFRESH_TOKEN",
      }),
      getSecret: (key) => `resolved-${key}`,
      http: outboundHttpRequestPort(request),
    });

    await expect(source.probe()).resolves.toEqual([{
      id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
      moduleName: "google-workspace",
      status: "ready",
      message: "Google Workspace OAuth token refresh succeeded.",
    }]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("reports OAuth refresh failure as reauthorization required", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });
    const source = createGoogleWorkspaceReadinessSource({
      getConfig: () => ({
        clientId: "$GOOGLE_CLIENT_ID",
        clientSecret: "$GOOGLE_CLIENT_SECRET",
        refreshToken: "$GOOGLE_REFRESH_TOKEN",
      }),
      getSecret: (key) => `resolved-${key}`,
      http: outboundHttpRequestPort(request),
    });

    await expect(source.probe()).resolves.toEqual([{
      id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
      moduleName: "google-workspace",
      status: "unavailable",
      reason: "oauth_refresh_failed",
      message:
        "Google Workspace OAuth token refresh failed; reauthorization is required.",
    }]);
  });
});
