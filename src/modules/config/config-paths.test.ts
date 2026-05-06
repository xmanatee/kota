import { describe, expect, it } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import { asResolvedConfigView, getConfigPath, setConfigPath } from "./config-paths.js";

function makeConfig(overrides: Partial<KotaConfig> = {}): KotaConfig {
  return overrides as KotaConfig;
}

describe("getConfigPath", () => {
  it("returns top-level leaf value for a single-segment key", () => {
    const config = makeConfig({ model: "claude-opus-4-7" });
    expect(getConfigPath(config, ["model"])).toEqual({
      found: true,
      value: "claude-opus-4-7",
    });
  });

  it("returns nested leaf value at supported depth", () => {
    const config = makeConfig({
      modelTiers: { fast: "claude-haiku-4-5", balanced: "claude-sonnet-4-6", capable: "claude-opus-4-7" },
    });
    expect(getConfigPath(config, ["modelTiers", "fast"])).toEqual({
      found: true,
      value: "claude-haiku-4-5",
    });
  });

  it("returns the matched object when the path stops at an intermediate node", () => {
    const config = makeConfig({ user: { name: "alice", context: "ctx" } });
    expect(getConfigPath(config, ["user"])).toEqual({
      found: true,
      value: { name: "alice", context: "ctx" },
    });
  });

  it("returns not_found when an intermediate segment is missing", () => {
    const config = makeConfig({ user: { name: "alice" } });
    expect(getConfigPath(config, ["user", "missing", "leaf"])).toEqual({
      found: false,
      reason: "not_found",
    });
  });

  it("returns not_found when the top-level key is missing", () => {
    const config = makeConfig({ model: "claude-opus-4-7" });
    expect(getConfigPath(config, ["nonexistent"])).toEqual({
      found: false,
      reason: "not_found",
    });
  });

  it("returns not_found when traversal hits a primitive before exhausting parts", () => {
    const config = makeConfig({ model: "claude-opus-4-7" });
    expect(getConfigPath(config, ["model", "name"])).toEqual({
      found: false,
      reason: "not_found",
    });
  });

  it("returns not_found when an intermediate segment is an array", () => {
    const config = makeConfig({ autoEnable: ["web", "code"] });
    expect(getConfigPath(config, ["autoEnable", "0"])).toEqual({
      found: false,
      reason: "not_found",
    });
  });

  it("returns the leaf even when the leaf value is null", () => {
    const config = { user: { name: null } } as unknown as KotaConfig;
    expect(getConfigPath(config, ["user", "name"])).toEqual({
      found: true,
      value: null,
    });
  });
});

describe("setConfigPath", () => {
  it("replaces the top-level entry on a single-segment set", () => {
    const draft: Partial<KotaConfig> = { model: "claude-sonnet-4-6", maxTokens: 1024 };
    const next = setConfigPath(draft, ["model"], "claude-opus-4-7");
    expect(next).toEqual({ model: "claude-opus-4-7", maxTokens: 1024 });
  });

  it("merges into an existing nested object on a two-segment set", () => {
    const draft: Partial<KotaConfig> = {
      modelTiers: { fast: "claude-haiku-4-5", balanced: "claude-sonnet-4-6" },
    };
    const next = setConfigPath(draft, ["modelTiers", "balanced"], "claude-opus-4-7");
    expect(next).toEqual({
      modelTiers: { fast: "claude-haiku-4-5", balanced: "claude-opus-4-7" },
    });
  });

  it("creates a fresh nested object when the top-level slot is absent", () => {
    const draft: Partial<KotaConfig> = { model: "claude-opus-4-7" };
    const next = setConfigPath(draft, ["modelTiers", "fast"], "claude-haiku-4-5");
    expect(next).toEqual({
      model: "claude-opus-4-7",
      modelTiers: { fast: "claude-haiku-4-5" },
    });
  });

  it("creates a fresh nested object when the top-level slot is non-object", () => {
    const draft = { model: "claude-opus-4-7" } as unknown as Partial<KotaConfig>;
    const next = setConfigPath(
      draft,
      ["model", "alias"] as readonly [string, ...string[]],
      "shortcut",
    );
    expect(next).toEqual({ model: { alias: "shortcut" } });
  });

  it("creates a fresh nested object when the top-level slot is an array", () => {
    const draft = { autoEnable: ["web"] } as unknown as Partial<KotaConfig>;
    const next = setConfigPath(
      draft,
      ["autoEnable", "first"] as readonly [string, ...string[]],
      "code",
    );
    expect(next).toEqual({ autoEnable: { first: "code" } });
  });

  it("does not mutate the input draft", () => {
    const draft: Partial<KotaConfig> = {
      modelTiers: { fast: "claude-haiku-4-5" },
    };
    const next = setConfigPath(draft, ["modelTiers", "balanced"], "claude-sonnet-4-6");
    expect(draft).toEqual({ modelTiers: { fast: "claude-haiku-4-5" } });
    expect(next).not.toBe(draft);
  });
});

describe("asResolvedConfigView", () => {
  it("returns the resolved config as a plain string-keyed record", () => {
    const config = makeConfig({ model: "claude-opus-4-7", maxTokens: 4096 });
    const view = asResolvedConfigView(config);
    expect(view.model).toBe("claude-opus-4-7");
    expect(view.maxTokens).toBe(4096);
  });
});
