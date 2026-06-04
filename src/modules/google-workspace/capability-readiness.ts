import type {
  CapabilityReadiness,
  CapabilityReadinessSource,
} from "#core/daemon/capability-readiness.js";
import {
  type GoogleWorkspaceSecretResolver,
  refreshGoogleAccessToken,
  resolveSecretReference,
} from "./auth.js";

const MODULE_NAME = "google-workspace";
export const GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID = "google-workspace.oauth";

export type GoogleWorkspaceOAuthConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export function createGoogleWorkspaceReadinessSource(opts: {
  getConfig: () => GoogleWorkspaceOAuthConfig | undefined;
  getSecret: GoogleWorkspaceSecretResolver;
}): CapabilityReadinessSource {
  return {
    moduleName: MODULE_NAME,
    async probe(): Promise<CapabilityReadiness[]> {
      const config = opts.getConfig();
      if (!config?.clientId || !config.clientSecret || !config.refreshToken) {
        return [{
          id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "oauth_config_missing",
          message:
            "Google Workspace OAuth config references are missing.",
        }];
      }

      const clientId = resolveSecretReference(config.clientId, opts.getSecret);
      const clientSecret = resolveSecretReference(config.clientSecret, opts.getSecret);
      const refreshToken = resolveSecretReference(config.refreshToken, opts.getSecret);
      if (!clientId || !clientSecret || !refreshToken) {
        return [{
          id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "oauth_secret_missing",
          message:
            "Google Workspace OAuth secret references are missing.",
        }];
      }

      try {
        await refreshGoogleAccessToken(clientId, clientSecret, refreshToken);
        return [{
          id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
          moduleName: MODULE_NAME,
          status: "ready",
          message: "Google Workspace OAuth token refresh succeeded.",
        }];
      } catch {
        return [{
          id: GOOGLE_WORKSPACE_OAUTH_CAPABILITY_ID,
          moduleName: MODULE_NAME,
          status: "unavailable",
          reason: "oauth_refresh_failed",
          message:
            "Google Workspace OAuth token refresh failed; reauthorization is required.",
        }];
      }
    },
  };
}
