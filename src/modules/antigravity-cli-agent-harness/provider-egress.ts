import { NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV } from "#core/agent-harness/native-cli-egress-proxy.js";
import { buildNativeCliEnvironment } from "#core/agent-harness/native-cli-environment.js";
import { ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV } from "./runtime-home.js";

export const ANTIGRAVITY_CLI_PROVIDER_AUTH_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

export const ANTIGRAVITY_CLI_PROVIDER_EGRESS_HOSTS = [
  "accounts.google.com",
  "aiplatform.googleapis.com",
  "businessaicode.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "generativelanguage.googleapis.com",
  "lh3.googleusercontent.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
] as const;

export function buildAntigravityCliEnvironment(input: {
  inheritedEnv: NodeJS.ProcessEnv;
  overrides: Readonly<Record<string, string>> | undefined;
  keychainDirectory: string | undefined;
}): NodeJS.ProcessEnv {
  const upstreamProxyUrl = input.inheritedEnv[
    NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV
  ]?.trim() || undefined;
  const providerEgressActive = upstreamProxyUrl !== undefined;
  return buildNativeCliEnvironment({
    inheritedEnv: input.inheritedEnv,
    projectedEnvKeys: [
      ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV,
      ...(providerEgressActive
        ? [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]
        : []),
    ],
    authenticationEnvKeys: providerEgressActive
      ? ANTIGRAVITY_CLI_PROVIDER_AUTH_ENV_KEYS
      : [],
    blockedEnvKeys: providerEgressActive
      ? []
      : [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV],
    overrides: {
      ...(input.overrides ?? {}),
      ...(upstreamProxyUrl === undefined
        ? {}
        : { [NATIVE_CLI_EGRESS_UPSTREAM_PROXY_ENV]: upstreamProxyUrl }),
      ...(input.keychainDirectory === undefined
        ? {}
        : { [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: input.keychainDirectory }),
      NO_COLOR: "1",
    },
  });
}
