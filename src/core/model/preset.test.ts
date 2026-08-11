import { describe, expect, it } from "vitest";
import {
  checkPresetAuth,
  getPreset,
  hasPreset,
  listShippedPresetIds,
  listShippedPresets,
  mergePresetTiers,
  type Preset,
  resolvePreset,
  resolvePresetTierModel,
  SHIPPED_DEFAULT_PRESET_ID,
} from "./preset.js";

describe("shipped preset registry", () => {
  it("every shipped preset declares model tiers and an explicit auth contract", () => {
    for (const preset of listShippedPresets()) {
      expect(preset.defaultModel.length).toBeGreaterThan(0);
      expect(preset.tiers.fast.length).toBeGreaterThan(0);
      expect(preset.tiers.balanced.length).toBeGreaterThan(0);
      expect(preset.tiers.capable.length).toBeGreaterThan(0);
      expect(Array.isArray(preset.authEnv)).toBe(true);
      expect(preset.harness.length).toBeGreaterThan(0);
      expect(preset.defaultEffort).toMatch(/^(low|medium|high|xhigh|max)$/);
    }
  });

  it("no two shipped presets share an id, harness pairing collision aside", () => {
    const ids = listShippedPresets().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no preset entry inherits authEnv values from another preset by accident", () => {
    const presets = listShippedPresets();
    for (let i = 0; i < presets.length; i++) {
      for (let j = i + 1; j < presets.length; j++) {
        expect(presets[i].authEnv).not.toBe(presets[j].authEnv);
      }
    }
  });

  it("hasPreset returns true for shipped ids and false for unknown ones", () => {
    for (const id of listShippedPresetIds()) {
      expect(hasPreset(id)).toBe(true);
    }
    expect(hasPreset("nonexistent")).toBe(false);
  });

  it("getPreset throws a loud error naming the available ids when given an unknown id", () => {
    expect(() => getPreset("nonexistent")).toThrow(
      `Unknown preset "nonexistent". Shipped presets: ${listShippedPresetIds().join(", ")}.`,
    );
  });

  it("the shipped default preset is part of the shipped registry", () => {
    expect(hasPreset(SHIPPED_DEFAULT_PRESET_ID)).toBe(true);
  });
});

describe("resolvePreset", () => {
  it("flag wins over env, config, and the shipped default", () => {
    const { preset, source } = resolvePreset({ flag: "codex", env: "gemini", config: "claude" });
    expect(preset.id).toBe("codex");
    expect(source).toBe("flag");
  });

  it("env wins over config and the shipped default when no flag is given", () => {
    const { preset, source } = resolvePreset({ env: "gemini", config: "claude" });
    expect(preset.id).toBe("gemini");
    expect(source).toBe("env");
  });

  it("config wins over the shipped default when no flag or env is given", () => {
    const { preset, source } = resolvePreset({ config: "codex" });
    expect(preset.id).toBe("codex");
    expect(source).toBe("config");
  });

  it("falls back to the shipped default when nothing is provided", () => {
    const { preset, source } = resolvePreset({});
    expect(preset.id).toBe(SHIPPED_DEFAULT_PRESET_ID);
    expect(source).toBe("default");
  });

  it("treats empty strings as 'not provided'", () => {
    const { preset, source } = resolvePreset({ flag: "", env: "", config: "codex" });
    expect(preset.id).toBe("codex");
    expect(source).toBe("config");
  });

  it("throws when an explicitly named preset is unknown — never falls through silently", () => {
    expect(() => resolvePreset({ flag: "wat" })).toThrow(/Unknown preset "wat"/);
    expect(() => resolvePreset({ env: "wat" })).toThrow(/Unknown preset "wat"/);
    expect(() => resolvePreset({ config: "wat" })).toThrow(/Unknown preset "wat"/);
  });
});

describe("mergePresetTiers and resolvePresetTierModel", () => {
  const codex = getPreset("codex");

  it("returns the preset's own tiers when there are no overrides", () => {
    expect(mergePresetTiers(codex, undefined)).toEqual(codex.tiers);
  });

  it("operator overrides win on a per-tier basis", () => {
    const merged = mergePresetTiers(codex, { capable: "operator-capable-model" });
    expect(merged.capable).toBe("operator-capable-model");
    expect(merged.fast).toBe(codex.tiers.fast);
    expect(merged.balanced).toBe(codex.tiers.balanced);
  });

  it("resolvePresetTierModel honors overrides", () => {
    expect(resolvePresetTierModel(codex, "fast")).toBe(codex.tiers.fast);
    expect(resolvePresetTierModel(codex, "fast", { fast: "operator-fast-model" })).toBe(
      "operator-fast-model",
    );
  });
});

describe("checkPresetAuth", () => {
  const codex = getPreset("codex");

  it("honors each shipped preset's declared env-auth contract", () => {
    for (const preset of listShippedPresets()) {
      const unset = checkPresetAuth(preset, {});
      expect(unset.missing).toEqual(preset.authEnv);
      for (const envName of preset.authEnv) {
        expect(checkPresetAuth(preset, { [envName]: "test-key" }).missing).toEqual([]);
      }
    }
  });

  it("returns the inspected preset for downstream messaging", () => {
    const r: { preset: Preset; missing: readonly string[] } = checkPresetAuth(codex, {});
    expect(r.preset.id).toBe("codex");
  });
});
