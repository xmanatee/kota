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
