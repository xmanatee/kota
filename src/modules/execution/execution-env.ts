import { buildFilteredInheritedSubprocessEnv } from "#core/modules/subprocess-env.js";
import type { ToolRunnerContext } from "#core/tools/index.js";

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

function stripEvalHarnessProviderEgressEnv(env: NodeJS.ProcessEnv): void {
  const providerEgressActive = env.KOTA_EVAL_PROVIDER_EGRESS_ACTIVE === "1";
  const authEnvKeys = providerEgressAuthEnvKeys(env);
  for (const key of Object.keys(env)) {
    if (
      key.startsWith(PROVIDER_EGRESS_ENV_PREFIX) ||
      authEnvKeys.includes(key) ||
      (providerEgressActive && PROVIDER_EGRESS_PROXY_ENV_KEYS.has(key))
    ) {
      delete env[key];
    }
  }
}

export function buildExecutionEnv(
  context?: ToolRunnerContext,
): NodeJS.ProcessEnv {
  const env = buildFilteredInheritedSubprocessEnv();
  stripEvalHarnessProviderEgressEnv(env);
  if (context?.sessionId) env.KOTA_SESSION_ID = context.sessionId;
  if (context?.toolUseId) env.KOTA_TOOL_USE_ID = context.toolUseId;
  return env;
}
