import { describe, expect, it } from "vitest";
import type { KotaConfig } from "../../config.js";
import { computeModuleConfigDiff } from "./config-reload-diff.js";

describe("computeModuleConfigDiff", () => {
  const allModules = [
    { name: "git", dependencies: [] },
    { name: "github", dependencies: ["git"] },
    { name: "fs", dependencies: [] },
  ];

  it("returns no changed modules when nothing changed", () => {
    const config: KotaConfig = { modules: { git: { token: "abc" } } };
    const result = computeModuleConfigDiff(config, config, allModules);
    expect(result.changedModules).toEqual([]);
    expect(result.isFullReload).toBe(false);
  });

  it("returns no changed modules when both configs are empty", () => {
    const result = computeModuleConfigDiff({}, {}, allModules);
    expect(result.changedModules).toEqual([]);
    expect(result.isFullReload).toBe(false);
  });

  it("returns only the changed module when one module config changes", () => {
    const oldConfig: KotaConfig = { modules: { fs: { enabled: true }, git: { token: "abc" } } };
    const newConfig: KotaConfig = { modules: { fs: { enabled: false }, git: { token: "abc" } } };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.changedModules).toEqual(["fs"]);
    expect(result.isFullReload).toBe(false);
  });

  it("includes dependent modules when a dependency's config changes", () => {
    const oldConfig: KotaConfig = { modules: { git: { token: "old" } } };
    const newConfig: KotaConfig = { modules: { git: { token: "new" } } };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.changedModules).toContain("git");
    expect(result.changedModules).toContain("github"); // github depends on git
    expect(result.changedModules).not.toContain("fs");
    expect(result.isFullReload).toBe(false);
  });

  it("triggers full reload when a global config key changes", () => {
    const oldConfig: KotaConfig = { model: "claude-3-5-sonnet-20241022" };
    const newConfig: KotaConfig = { model: "claude-opus-4-6" };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.isFullReload).toBe(true);
    expect(result.changedModules).toEqual(["git", "github", "fs"]);
  });

  it("triggers full reload when guardrails config changes", () => {
    const oldConfig: KotaConfig = { guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "confirm" } } };
    const newConfig: KotaConfig = { guardrails: { policies: { safe: "allow", moderate: "confirm", dangerous: "confirm" } } };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.isFullReload).toBe(true);
    expect(result.changedModules).toHaveLength(3);
  });

  it("triggers full reload when a global key is added", () => {
    const oldConfig: KotaConfig = {};
    const newConfig: KotaConfig = { verbose: true };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.isFullReload).toBe(true);
  });

  it("triggers full reload when a global key is removed", () => {
    const oldConfig: KotaConfig = { verbose: true };
    const newConfig: KotaConfig = {};
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.isFullReload).toBe(true);
  });

  it("does not trigger full reload when only modules config changes", () => {
    const oldConfig: KotaConfig = { modules: { git: { token: "old" } } };
    const newConfig: KotaConfig = { modules: { git: { token: "new" } } };
    const result = computeModuleConfigDiff(oldConfig, newConfig, allModules);
    expect(result.isFullReload).toBe(false);
  });

  it("handles transitive dependencies", () => {
    const chain = [
      { name: "a", dependencies: [] },
      { name: "b", dependencies: ["a"] },
      { name: "c", dependencies: ["b"] },
    ];
    const oldConfig: KotaConfig = { modules: { a: { key: "old" } } };
    const newConfig: KotaConfig = { modules: { a: { key: "new" } } };
    const result = computeModuleConfigDiff(oldConfig, newConfig, chain);
    expect(result.changedModules).toContain("a");
    expect(result.changedModules).toContain("b");
    expect(result.changedModules).toContain("c");
    expect(result.isFullReload).toBe(false);
  });
});
