import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessReadinessRequest,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { getPreset } from "#core/model/preset.js";
import { checkPresetHarnessReadiness } from "./doctor-preset-readiness.js";

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

function registerUnavailableSelectionHarness(
  harnessId: string,
  observed: AgentHarnessReadinessRequest[],
): void {
  const harness: AgentHarness = {
    name: harnessId,
    description: "selection-aware doctor test harness",
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    readiness: (request) => {
      if (request === undefined) throw new Error("expected an exact selection");
      observed.push(request);
      const adapterModel = `${request.model}@${request.effort}`;
      return {
        adapterKind: "native-cli",
        localRuntime: {
          kind: "node-package",
          status: "ready",
          required: true,
          packageName: "doctor-test-runtime",
          version: "1.0.0",
          summary: "doctor-test-runtime@1.0.0",
        },
        localAuth: {
          kind: "harness-managed-login",
          status: "ready",
          required: true,
          command: "agy models",
          detail: "test login ready",
          summary: "test login ready",
        },
        modelEffort: {
          kind: "model-effort",
          required: true,
          status: "unavailable",
          model: request.model,
          effort: request.effort,
          adapterModel,
          command: "agy models",
          summary: `AGY selection ${adapterModel} is unavailable`,
          detail: "The active AGY catalog does not expose this selection.",
        },
        optionalRuntimes: [],
        unsupportedOptions: [],
      };
    },
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

describe("doctor preset model readiness", () => {
  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("fails visibly for the active unavailable model and effort", () => {
    const preset = getPreset("antigravity-cli");
    const configuredModel = `${preset.id}-configured-capable`;
    const observed: AgentHarnessReadinessRequest[] = [];
    vi.mocked(loadConfig).mockReturnValue({
      modelTiers: { capable: configuredModel },
    });
    registerUnavailableSelectionHarness(preset.harness, observed);

    const results = checkPresetHarnessReadiness("/project", preset.id);
    const presetRow = results.find((row) => row.label === `Preset: ${preset.id}`);
    const selectionRow = results.find(
      (row) => row.label === `Preset model/effort: ${preset.id}`,
    );
    const supportedRow = results.find(
      (row) => row.label === `Preset supported capabilities: ${preset.id}`,
    );
    const limitsRow = results.find(
      (row) => row.label === `Preset intentional limits: ${preset.id}`,
    );

    expect(observed).toEqual([
      { model: configuredModel, effort: preset.defaultEffort },
    ]);
    expect(presetRow?.status).toBe("fail");
    expect(presetRow?.detail).toContain("model/effort");
    expect(selectionRow?.status).toBe("fail");
    expect(selectionRow?.detail).toContain(configuredModel);
    expect(selectionRow?.detail).toContain(preset.defaultEffort);
    expect(supportedRow).toMatchObject({
      status: "pass",
      detail: "toolControl=native; multiTurn",
    });
    expect(limitsRow).toMatchObject({
      status: "info",
      detail: "ownerQuestions, agentMessageStream",
    });
  });
});
