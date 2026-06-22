import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { getPreset } from "./preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
} from "./preset-readiness.js";

function registerAntigravityHarnessWithUnverifiableAuth(): void {
  const harness: AgentHarness = {
    name: "antigravity-cli",
    description: "test antigravity harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    readiness: () => ({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        status: "ready",
        required: true,
        command: "agy --version",
        binaryName: "agy",
        executablePath: "/opt/bin/agy",
        version: "agy 2.0.0",
        summary: "agy 2.0.0 at /opt/bin/agy",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "unverifiable",
        required: true,
        command: "agy",
        detail: "no non-interactive auth-status command",
        summary:
          "Antigravity CLI auth cannot be verified non-interactively",
      },
      optionalRuntimes: [],
      unsupportedOptions: [
        {
          option: "canUseTool",
          reason: "not routed",
        },
      ],
    }),
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: true,
    }),
  };
  registerAgentHarness(harness);
}

describe("preset harness readiness for unverifiable auth", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("preserves unverifiable harness-managed auth without marking the preset ready", () => {
    registerAntigravityHarnessWithUnverifiableAuth();

    const readiness = collectPresetHarnessReadiness(getPreset("antigravity-cli"), {
      env: { GEMINI_API_KEY: "g-test" },
      now: () => new Date("2026-05-26T00:00:00.000Z"),
    });

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: false,
      missing: [],
      probe: {
        status: "unverifiable",
        command: "agy",
      },
      summary:
        "harness-managed auth unverifiable (Antigravity CLI auth cannot be verified non-interactively)",
    });
    expect(isPresetHarnessReadinessReady(readiness)).toBe(false);
  });
});
