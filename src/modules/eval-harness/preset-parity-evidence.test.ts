import { describe, expect, it } from "vitest";
import { getPreset } from "#core/model/preset.js";
import { assertPresetParityModels, type ParityCall, type ParityEvidence, parityEvidenceSchema } from "./preset-parity-evidence.js";

const preset = getPreset("codex");
function evidence(change: Partial<ParityCall> = {}): ParityEvidence {
  return {
    presetId: preset.id,
    starts: [{ runId: "probe", workflow: "probe", presetId: preset.id, harness: preset.harness }],
    calls: [{ id: 0, surface: "workflow", presetId: preset.id, boundary: "harness",
      harness: preset.harness, model: preset.tiers.balanced, requestedModel: preset.tiers.balanced,
      runId: "probe", tools: [], status: "success", turns: 1, ...change }],
  };
}

describe("preset parity adapter model sweep", () => {
  it.each(["single-turn", "tool-turn", "workflow"] as const)("accepts resolved balanced %s calls and rejects a wrong tier inside the catalog", (surface) => {
    expect(() => assertPresetParityModels(preset, evidence({ surface }))).not.toThrow();
    expect(() => assertPresetParityModels(preset, evidence({ surface, model: preset.tiers.capable }))).toThrow("expected");
  });
  it.each([
    { model: null },
    { model: getPreset("claude").defaultModel },
    { requestedModel: getPreset("gemini").defaultModel },
    { presetId: "other" },
    { harness: "other" },
  ])("rejects missing selection, foreign fallback, and configuration drift: %j", (change) => {
    expect(() => assertPresetParityModels(preset, evidence(change))).toThrow();
  });
  it("sweeps failed and incidental calls as well as the successful response", () => {
    const value = evidence();
    value.calls.push({ ...value.calls[0], id: 1, boundary: "model-client", status: "error", model: "foreign" });
    expect(() => assertPresetParityModels(preset, value)).toThrow("call 1");
  });
  it("rejects vacuous evidence and a sticky run-start mismatch", () => {
    const value = evidence();
    value.calls = [];
    expect(() => assertPresetParityModels(preset, value)).toThrow("No adapter calls");
    const mismatch = evidence();
    mismatch.starts[0].presetId = "other";
    expect(() => assertPresetParityModels(preset, mismatch)).toThrow("sticky");
    expect(parityEvidenceSchema.safeParse({ calls: [] }).success).toBe(false);
  });
});
