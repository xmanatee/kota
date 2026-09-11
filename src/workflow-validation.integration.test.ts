import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/registry.js";
import { getPreset } from "#core/model/preset.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
  type WorkflowValidationOptions,
} from "#core/workflow/validation.js";
import { antigravityCliAgentHarness } from "#modules/antigravity-cli-agent-harness/adapter.js";
import autonomyModule from "#modules/autonomy/index.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { geminiAgentHarness } from "#modules/gemini-agent-harness/adapter.js";
import { geminiCliAgentHarness } from "#modules/gemini-cli-agent-harness/adapter.js";

// Integration owns the join between real module contributions and the core
// validator. Definition shape/restart/event policy belongs to core/workflow.
let root: string;
beforeEach(() => {
  clearAgentHarnessRegistryForTest();
  for (const harness of [
    antigravityCliAgentHarness,
    claudeAgentHarness,
    codexAgentHarness,
    geminiAgentHarness,
    geminiCliAgentHarness,
  ]) {
    registerAgentHarness(harness);
  }
  root = mkdtempSync(join(tmpdir(), "kota-module-validation-"));
  writeFileSync(join(root, "prompt.md"), "Review.\n");
});
afterEach(() => {
  clearAgentHarnessRegistryForTest();
  rmSync(root, { recursive: true, force: true });
});
function validateAgent(
  step: Record<string, unknown> = {},
  options: WorkflowValidationOptions = {},
) {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition("fixture.ts", {
        repository: "read",
        name: "fixture",
        triggers: [{ event: "manual" }],
        steps: [
          {
            id: "review",
            type: "agent",
            promptPath: "prompt.md",
            model: "claude-opus-4-7",
            effort: "xhigh",
            autonomyMode: "autonomous",
            ...step,
          },
        ],
      }),
    ],
    root,
    { defaultAgentHarness: claudeAgentHarness.name, preset: getPreset("claude"), ...options },
  )[0].steps[0];
}

describe("module agent contracts through workflow validation", () => {
  it.each([
    [claudeAgentHarness.name, "claude-opus-4-7"],
    [codexAgentHarness.name, "gpt-5.6-sol"],
    [geminiAgentHarness.name, "gemini-2.5-pro"],
    [geminiCliAgentHarness.name, "gemini-2.5-pro"],
  ])("resolves %s's model contract", (harness, model) => {
    expect(validateAgent({ harness, model })).toMatchObject({ harness, model });
  });

  it.each([
    [{ model: "gpt-4-turbo" }, /unknown model "gpt-4-turbo" for harness "claude-agent-sdk"/],
    [
      { harness: "codex", model: "gpt-5.6-sol", autonomyMode: "passive" },
      /codex.*autonomyMode="passive".*cannot be classified and denied individually/,
    ],
    [
      { autonomyMode: "supervised" },
      /claude-agent-sdk.*autonomyMode="supervised".*no native route into KOTA's approval queue/,
    ],
  ])("propagates module rejection with source and step context: %j", (step, error) => {
    expect(() => validateAgent(step)).toThrow(/fixture\.ts: workflow "fixture" steps\[0\]/);
    expect(() => validateAgent(step)).toThrow(error);
  });

  it("resolves preset tiers and preserves operator override precedence", () => {
    const preset = getPreset("codex");
    const step = { harness: preset.harness, model: undefined, tier: "capable" };
    expect(validateAgent(step, { preset })).toMatchObject({
      tier: "capable",
      model: preset.tiers.capable,
    });
    expect(validateAgent(step, { preset, modelTiers: { capable: "custom-model" } })).toMatchObject({
      tier: "capable",
      model: "custom-model",
    });
    expect(
      validateAgent(step, {
        preset: undefined,
        defaultAgentEffort: "high",
        modelTiers: { capable: "explicit-model" },
      }),
    ).toMatchObject({ tier: "capable", model: "explicit-model" });
  });

  it("propagates validated adapter options and removes empty option blocks", () => {
    const harnessOptions = {
      "claude-agent-sdk": {
        permissionMode: "acceptEdits",
        settingSources: ["project", "local"],
      },
    };
    expect(validateAgent({ harnessOptions })).toMatchObject({ harnessOptions });
    for (const empty of [{}, { "claude-agent-sdk": {} }]) {
      const step = validateAgent({ harnessOptions: empty });
      expect(step.type).toBe("agent");
      if (step.type !== "agent") throw new Error("expected agent");
      expect(step.harnessOptions).toBeUndefined();
    }
  });

  it.each([
    [{ "openai-tools": {} }, undefined, /key "openai-tools" does not match/],
    [{ "claude-agent-sdk": {}, "openai-tools": {} }, undefined, /at most one key/],
    [{ "made-up-harness": {} }, "made-up-harness", /unknown harness "made-up-harness"/],
    [
      { "claude-agent-sdk": { permissionMode: "nope" } },
      undefined,
      /steps\[0\].harnessOptions.*rejected by harness validator: .*permissionMode must be one of/,
    ],
    [
      { "claude-agent-sdk": { bogus: true } },
      undefined,
      /rejected by harness validator: unknown key/,
    ],
    [
      { "claude-agent-sdk": { settingSources: ["project", "bogus"] } },
      undefined,
      /settingSources entries must be one of/,
    ],
  ])("rejects incompatible adapter options %j", (harnessOptions, harness, error) => {
    expect(() => validateAgent({ harnessOptions, harness })).toThrow(error);
  });

  it("validates the autonomy module's actual contributions against registered adapters", async () => {
    if (typeof autonomyModule.workflows !== "function")
      throw new Error("expected contribution factory");
    const contributions = [...(await autonomyModule.workflows({} as never))].map((contribution) => {
      if (!("definitionPath" in contribution)) throw new Error("expected registered contribution");
      return contribution;
    });
    const definitions = validateWorkflowDefinitions(contributions, process.cwd(), {
      defaultAgentHarness: claudeAgentHarness.name,
      preset: getPreset("claude"),
    });
    // The module loader must receive the complete, validated contribution set.
    expect(definitions.map((definition) => definition.name)).toEqual(
      contributions.map((definition) => definition.name),
    );
    expect(definitions.length).toBeGreaterThan(0);
  });
});
