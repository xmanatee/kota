import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessAuthProbe,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import { getPreset } from "./preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
} from "./preset-readiness.js";

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
      usage: UNKNOWN_AGENT_USAGE,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

function registerCodexReadinessHarness(
  authStatus: "ready" | "expiring" | "stale" | "missing" | "error",
): void {
  const authProbe = makeCodexAuthProbe(authStatus);
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
      localAuth: authProbe,
      optionalRuntimes: [],
      unsupportedOptions: [],
    }),
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      usage: UNKNOWN_AGENT_USAGE,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

function makeCodexAuthProbe(
  status: "ready" | "expiring" | "stale" | "missing" | "error",
): AgentHarnessAuthProbe {
  if (status === "ready") {
    return {
      kind: "harness-managed-login",
      status,
      required: true,
      command: "codex login status",
      detail: "Logged in using ChatGPT",
      summary: "Codex ChatGPT login active",
    };
  }
  if (status === "expiring") {
    return {
      kind: "harness-managed-login",
      status,
      required: true,
      command: "codex login status",
      detail: "Logged in using ChatGPT; expires at 2026-06-22T00:30:00.000Z",
      summary: "Codex ChatGPT login expires soon",
      expiresAt: "2026-06-22T00:30:00.000Z",
      renewalSummary: "run `codex login` before unattended runs",
    };
  }
  if (status === "stale") {
    return {
      kind: "harness-managed-login",
      status,
      required: true,
      command: "codex login status",
      detail: "Codex ChatGPT login expired at 2026-06-21T23:59:00.000Z",
      summary: "Codex ChatGPT login expired",
      expiredAt: "2026-06-21T23:59:00.000Z",
      renewalSummary: "run `codex login` before unattended runs",
    };
  }
  return {
    kind: "harness-managed-login",
    status,
    required: true,
    command: "codex login status",
    detail: status === "error" ? "login status failed" : "Not logged in",
    summary:
      status === "error"
        ? "Codex ChatGPT login probe failed"
        : "Codex ChatGPT login not active; run `codex login`",
  };
}

function registerAntigravityReadinessHarness(): void {
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
        status: "missing",
        required: true,
        command: "agy",
        detail: "no non-interactive auth-status command",
        summary:
          "Antigravity CLI login cannot be verified non-interactively; run `agy` and sign in",
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
      usage: UNKNOWN_AGENT_USAGE,
      isError: true,
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
    const preset = getPreset("gemini");

    const readiness = collectPresetHarnessReadiness(preset, {
      env: {},
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness).toMatchObject({
      presetId: preset.id,
      harnessId: preset.harness,
      defaultModel: preset.defaultModel,
      tiers: preset.tiers,
      auth: {
        mode: "env",
        ready: false,
        missing: preset.authEnv,
      },
      adapter: {
        adapterKind: "provider-sdk",
        localRuntime: {
          status: "ready",
          packageName: "@google/genai",
        },
      },
      capabilities: {
        toolControl: "kota",
        supportsMultiTurn: true,
        supportsOwnerQuestions: true,
      },
      capturedAt: "2026-05-14T00:00:00.000Z",
    });
    expect(readiness.adapter.localRuntime.status).toBe("ready");
    expect(readiness.capabilities).not.toHaveProperty("localReadiness");
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

  it("treats expiring harness-managed auth as ready with a warning summary", () => {
    registerCodexReadinessHarness("expiring");

    const readiness = collectPresetHarnessReadiness(getPreset("codex"), {
      env: {},
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: true,
      probe: {
        status: "expiring",
        expiresAt: "2026-06-22T00:30:00.000Z",
        renewalSummary: "run `codex login` before unattended runs",
      },
      summary:
        "harness-managed auth expiring (Codex ChatGPT login expires soon, expiresAt=2026-06-22T00:30:00.000Z; run `codex login` before unattended runs)",
    });
    expect(isPresetHarnessReadinessReady(readiness)).toBe(true);
  });

  it("treats stale locally observable harness auth as not ready", () => {
    registerCodexReadinessHarness("stale");

    const readiness = collectPresetHarnessReadiness(getPreset("codex"), {
      env: {},
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(readiness.auth).toMatchObject({
      mode: "harness-managed-login",
      ready: false,
      probe: {
        status: "stale",
        expiredAt: "2026-06-21T23:59:00.000Z",
      },
      summary:
        "harness-managed auth stale (Codex ChatGPT login expired, expiredAt=2026-06-21T23:59:00.000Z; run `codex login` before unattended runs)",
    });
    expect(isPresetHarnessReadinessReady(readiness)).toBe(false);
  });

  it("includes Antigravity CLI preset tiers while preserving harness-managed auth failure", () => {
    registerAntigravityReadinessHarness();
    const preset = getPreset("antigravity-cli");

    const readiness = collectPresetHarnessReadiness(preset, {
      env: { GEMINI_API_KEY: "g-test" },
      now: () => new Date("2026-05-26T00:00:00.000Z"),
    });

    expect(readiness).toMatchObject({
      presetId: "antigravity-cli",
      harnessId: "antigravity-cli",
      defaultModel: preset.defaultModel,
      tiers: preset.tiers,
      auth: {
        mode: "harness-managed-login",
        ready: false,
        missing: [],
        probe: {
          status: "missing",
          command: "agy",
        },
      },
      adapter: {
        adapterKind: "native-cli",
        localRuntime: {
          status: "ready",
          binaryName: "agy",
        },
      },
      capturedAt: "2026-05-26T00:00:00.000Z",
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
        usage: UNKNOWN_AGENT_USAGE,
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
