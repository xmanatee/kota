import { buildFilteredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { sessionEnvironmentForExecution } from "#core/tools/session-environment.js";

const PROVIDER_EGRESS_ENV_PREFIX = "KOTA_EVAL_PROVIDER_EGRESS_";
const PROVIDER_EGRESS_AUTH_ENV_KEYS = "KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS";
const PROVIDER_EGRESS_PROXY_ENV_KEYS = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]);
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function providerEgressAuthEnvKeys(env: NodeJS.ProcessEnv): string[] {
  if (env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE !== "1") return [];
  const raw = env[PROVIDER_EGRESS_AUTH_ENV_KEYS];
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `${PROVIDER_EGRESS_AUTH_ENV_KEYS} is required when eval-harness provider-egress is active.`,
    );
  }
  return raw.split(",").map((key) => {
    const trimmed = key.trim();
    if (!ENV_KEY_PATTERN.test(trimmed)) {
      throw new Error(
        `${PROVIDER_EGRESS_AUTH_ENV_KEYS} contains invalid env key "${trimmed}".`,
      );
    }
    return trimmed;
  });
}

type ProviderEgressBoundary = {
  active: boolean;
  authEnvKeys: ReadonlySet<string>;
};

function providerEgressBoundary(env: NodeJS.ProcessEnv): ProviderEgressBoundary {
  return {
    active: env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE === "1",
    authEnvKeys: new Set(providerEgressAuthEnvKeys(env)),
  };
}

function stripEvalHarnessProviderEgressEnv(
  env: NodeJS.ProcessEnv,
  boundary: ProviderEgressBoundary,
): void {
  for (const key of Object.keys(env)) {
    if (
      key.startsWith(PROVIDER_EGRESS_ENV_PREFIX) ||
      boundary.authEnvKeys.has(key) ||
      (boundary.active && PROVIDER_EGRESS_PROXY_ENV_KEYS.has(key))
    ) {
      delete env[key];
    }
  }
}

export function buildExecutionEnv(
  context?: ToolRunnerContext,
): NodeJS.ProcessEnv {
  const env = buildFilteredInheritedSubprocessEnv();
  // Capture the inherited eval boundary before caller/session overlays merge.
  // Those lower-trust inputs cannot disable it or restore filtered credentials.
  const providerBoundary = providerEgressBoundary(env);
  if (context?.env !== undefined) {
    for (const [key, value] of Object.entries(context.env)) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(sessionEnvironmentForExecution(context))) {
    env[key] = value;
  }
  stripEvalHarnessProviderEgressEnv(env, providerBoundary);
  if (context?.sessionId) env.KOTA_SESSION_ID = context.sessionId;
  if (context?.toolUseId) env.KOTA_TOOL_USE_ID = context.toolUseId;
  return env;
}
