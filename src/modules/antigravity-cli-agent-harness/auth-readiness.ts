import type {
  AgentHarnessAuthProbe,
  AgentHarnessRuntimeProbeDeps,
} from "#core/agent-harness/index.js";
import { probeNativeCliAuth } from "#core/agent-harness/index.js";
import { ANTIGRAVITY_CLI_BINARY_NAME } from "./cli-runner.js";
export function antigravityCliAuthReadiness(
  deps?: AgentHarnessRuntimeProbeDeps,
): AgentHarnessAuthProbe {
  return probeNativeCliAuth({
    binaryName: ANTIGRAVITY_CLI_BINARY_NAME,
    statusArgs: ["models"],
    required: true,
    readyPattern: /^[a-z0-9][a-z0-9._-]*-[a-z0-9._-]+(?:\s|$)/m,
    stalePattern: /(?:expired|refresh token)/i,
    missingPattern:
      /(?:log in|login|authentication required|unauthenticated|unauthorized|credentials)/i,
    readySummary: "Antigravity CLI login active and model catalog readable",
    staleSummary: "Antigravity CLI login is stale",
    missingSummary: "Antigravity CLI login not active; run `agy` and sign in",
    renewalSummary: "run `agy` and sign in again before unattended runs",
  }, deps);
}
