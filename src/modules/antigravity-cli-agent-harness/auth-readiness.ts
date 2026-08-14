import type {
  AgentHarnessAuthProbe,
  AgentHarnessRuntimeProbeDeps,
} from "#core/agent-harness/index.js";
import { probeNativeCliAuth } from "#core/agent-harness/index.js";
import { ANTIGRAVITY_CLI_BINARY_NAME } from "./cli-runner.js";
import { resolveAntigravityCliKeychainDirectory } from "./runtime-home.js";

export type AntigravityCliAuthReadinessOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

export function antigravityCliAuthReadiness(
  deps?: AgentHarnessRuntimeProbeDeps,
  options: AntigravityCliAuthReadinessOptions = {},
): AgentHarnessAuthProbe {
  const keychainDirectory = resolveAntigravityCliKeychainDirectory(
    options.env ?? process.env,
    options.platform ?? process.platform,
  );
  if (keychainDirectory !== undefined) {
    return {
      kind: "harness-managed-login",
      status: "error",
      required: true,
      command: "agy models",
      detail:
        "macOS Keychain-backed AGY authentication cannot be projected into " +
        "the auto-approved native tool process tree without a provider-only " +
        "broker or an invocation-local AGY-only credential store",
      summary: "Antigravity CLI provider auth broker unavailable",
    };
  }
  return probeNativeCliAuth({
    binaryName: ANTIGRAVITY_CLI_BINARY_NAME,
    statusArgs: ["models"],
    required: true,
    readyPattern: /^gemini-\S+/m,
    stalePattern: /(?:expired|refresh token)/i,
    missingPattern:
      /(?:log in|login|authentication required|unauthenticated|unauthorized|credentials)/i,
    readySummary: "Antigravity CLI login and model access ready",
    staleSummary: "Antigravity CLI login is stale",
    missingSummary: "Antigravity CLI login not active; run `agy` and sign in",
    renewalSummary: "run `agy` and sign in again before unattended runs",
  }, deps);
}
