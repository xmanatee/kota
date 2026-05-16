import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { getPreset } from "./preset.js";
import { collectPresetHarnessReadiness } from "./preset-readiness.js";

function registerGeminiReadinessHarness(): void {
  const harness: AgentHarness = {
    name: "gemini",
    description: "test gemini harness",
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: "ask_owner",
    emitsAgentMessageStream: false,
    toolControl: "kota",
    readiness: () => ({
      adapterKind: "provider-sdk",
      localRuntime: {
        kind: "node-package",
        status: "ready",
        required: true,
        packageName: "@google/genai",
        version: "1.51.0",
        summary: "@google/genai@1.51.0",
      },
      optionalRuntimes: [],
      unsupportedOptions: [
        {
          option: "mcpServers",
          reason: "not hosted",
        },
      ],
    }),
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

function registerCodexReadinessHarness(
  authStatus: "ready" | "missing" | "error",
): void {
  const harness: AgentHarness = {
    name: "codex",
    description: "test codex harness",
    supportsMultiTurn: true,
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
        command: "codex --version",
        binaryName: "codex",
        executablePath: "/opt/bin/codex",
        version: "codex-cli 0.130.0",
        summary: "codex-cli 0.130.0 at /opt/bin/codex",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: authStatus,
        required: true,
        command: "codex login status",
        detail:
          authStatus === "ready"
            ? "Logged in using ChatGPT"
            : "Not logged in",
        summary:
          authStatus === "ready"
            ? "Codex ChatGPT login active"
            : "Codex ChatGPT login not active; run `codex login`",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    }),
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

describe("preset harness readiness", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("reports missing env-auth alternatives without making provider calls", () => {
    registerGeminiReadinessHarness();

    const readiness = collectPresetHarnessReadiness(getPreset("gemini"), {
      env: {},
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness).toMatchObject({
      presetId: "gemini",
      harnessId: "gemini",
      defaultModel: "gemini-2.5-pro",
      tiers: {
        fast: "gemini-2.5-flash-lite",
        balanced: "gemini-2.5-flash",
        capable: "gemini-2.5-pro",
      },
      auth: {
        mode: "env",
        ready: false,
        missing: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      },
      adapter: {
        adapterKind: "provider-sdk",
        localRuntime: {
          status: "ready",
          packageName: "@google/genai",
        },
      },
      capturedAt: "2026-05-14T00:00:00.000Z",
    });
  });

  it("uses a harness-managed auth probe for Codex instead of accepting empty authEnv", () => {
    registerCodexReadinessHarness("missing");

    const readiness = collectPresetHarnessReadiness(getPreset("codex"), {
      env: { OPENAI_API_KEY: "sk-test" },
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: false,
      missing: [],
      probe: {
        status: "missing",
        command: "codex login status",
      },
      summary:
        "harness-managed auth not ready (Codex ChatGPT login not active; run `codex login`)",
    });
  });

  it("marks Codex ready only when the local ChatGPT login probe succeeds", () => {
    registerCodexReadinessHarness("ready");

    const readiness = collectPresetHarnessReadiness(getPreset("codex"), {
      env: {},
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: true,
      probe: {
        status: "ready",
        detail: "Logged in using ChatGPT",
      },
      summary:
        "harness-managed auth ready (Codex ChatGPT login active)",
    });
  });

  it("fails harness-managed auth when the adapter exposes no auth probe", () => {
    const harness: AgentHarness = {
      name: "codex",
      description: "test codex harness",
      supportsMultiTurn: true,
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
          command: "codex --version",
          binaryName: "codex",
          executablePath: "/opt/bin/codex",
          version: "codex-cli 0.130.0",
          summary: "codex-cli 0.130.0 at /opt/bin/codex",
        },
        optionalRuntimes: [],
        unsupportedOptions: [],
      }),
      run: async () => ({
        text: "",
        streamedText: "",
        turns: 0,
        isError: false,
      }),
    };
    registerAgentHarness(harness);

    const readiness = collectPresetHarnessReadiness(getPreset("codex"));

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: false,
      probe: {
        status: "error",
        command: "codex auth status",
      },
    });
  });
});
