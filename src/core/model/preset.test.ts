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

function resolutionFixtures(): readonly [Preset, Preset, Preset] {
  const [flag, env, config] = listShippedPresets();
  if (flag === undefined || env === undefined || config === undefined) {
    throw new Error("Preset precedence tests require three shipped presets");
  }
  return [flag, env, config];
}

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
    const [flag, env, config] = resolutionFixtures();
    const { preset, source } = resolvePreset({
      flag: flag.id,
      env: env.id,
      config: config.id,
    });
    expect(preset).toBe(flag);
    expect(source).toBe("flag");
  });

  it("env wins over config and the shipped default when no flag is given", () => {
    const [, env, config] = resolutionFixtures();
    const { preset, source } = resolvePreset({
      env: env.id,
      config: config.id,
    });
    expect(preset).toBe(env);
    expect(source).toBe("env");
  });

  it("config wins over the shipped default when no flag or env is given", () => {
    const [, , config] = resolutionFixtures();
    const { preset, source } = resolvePreset({ config: config.id });
    expect(preset).toBe(config);
    expect(source).toBe("config");
  });

  it("falls back to the shipped default when nothing is provided", () => {
    const { preset, source } = resolvePreset({});
    expect(preset.id).toBe(SHIPPED_DEFAULT_PRESET_ID);
    expect(source).toBe("default");
  });

  it("treats empty strings as 'not provided'", () => {
    const [, , config] = resolutionFixtures();
    const { preset, source } = resolvePreset({
      flag: "",
      env: "",
      config: config.id,
    });
    expect(preset).toBe(config);
    expect(source).toBe("config");
  });

  it("throws when an explicitly named preset is unknown — never falls through silently", () => {
    expect(() => resolvePreset({ flag: "wat" })).toThrow(/Unknown preset "wat"/);
    expect(() => resolvePreset({ env: "wat" })).toThrow(/Unknown preset "wat"/);
    expect(() => resolvePreset({ config: "wat" })).toThrow(/Unknown preset "wat"/);
  });
});

describe("mergePresetTiers and resolvePresetTierModel", () => {
  const preset = getPreset(SHIPPED_DEFAULT_PRESET_ID);

  it("returns the preset's own tiers when there are no overrides", () => {
    expect(mergePresetTiers(preset, undefined)).toEqual(preset.tiers);
  });

  it("operator overrides win on a per-tier basis", () => {
    const merged = mergePresetTiers(preset, { capable: "operator-capable-model" });
    expect(merged.capable).toBe("operator-capable-model");
    expect(merged.fast).toBe(preset.tiers.fast);
    expect(merged.balanced).toBe(preset.tiers.balanced);
  });

  it("resolvePresetTierModel honors overrides", () => {
    expect(resolvePresetTierModel(preset, "fast")).toBe(preset.tiers.fast);
    expect(resolvePresetTierModel(preset, "fast", { fast: "operator-fast-model" })).toBe(
      "operator-fast-model",
    );
  });
});

describe("checkPresetAuth", () => {
  const preset = getPreset(SHIPPED_DEFAULT_PRESET_ID);

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
    const result: { preset: Preset; missing: readonly string[] } =
      checkPresetAuth(preset, {});
    expect(result.preset).toBe(preset);
  });
});
