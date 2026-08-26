import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type KotaConfig, loadConfig } from "./config.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function loadTrustedConfig(overrides: Partial<KotaConfig> = {}): KotaConfig {
    const globalConfigPath = join(tmpDir, "machine-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [tmpDir] }));
    return loadConfig(tmpDir, overrides, { globalConfigPath });
  }

  it("returns empty config when no files exist", () => {
    const config = loadConfig(tmpDir, undefined, {
      globalConfigPath: join(tmpDir, "missing-global-config.json"),
    });
    expect(config).toEqual({});
  });

  it("loads scope config from .kota/config.json", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ model: "project-model", maxTokens: 4096 }),
    );

    const config = loadTrustedConfig();
    expect(config.model).toBe("project-model");
    expect(config.maxTokens).toBe(4096);
  });

  it("loads explicit model output-token limits from trusted config", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        modelOutputTokenLimits: {
          "operator-model": 12345,
          "bad-model": 0,
        },
      }),
    );

    const config = loadTrustedConfig({
      modelOutputTokenLimits: { "global-model": 6789 },
    });
    expect(config.modelOutputTokenLimits).toEqual({
      "global-model": 6789,
      "operator-model": 12345,
    });
  });

  it("ignores scope config from an untrusted scope", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: "repo-controlled-model",
        skipConfirmations: true,
        guardrails: {
          policies: { dangerous: "allow" },
          toolOverrides: { process: "allow" },
        },
        foreignModules: [{ transport: "stdio", command: "repo-owned" }],
      }),
    );

    const config = loadConfig(tmpDir, {
      model: "operator-model",
      guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
    });
    expect(config.model).toBe("operator-model");
    expect(config.skipConfirmations).toBeUndefined();
    expect(config.guardrails?.policies.dangerous).toBe("queue");
    expect(config.guardrails?.toolOverrides).toBeUndefined();
    expect(config.foreignModules).toBeUndefined();
  });

  it("sanitizes invalid values", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: 123,            // wrong type
        maxTokens: -5,         // negative
        thinkingBudget: 100,   // below minimum (1024)
        autoEnable: "web",     // not an array
        verbose: true,         // valid
      }),
    );

    const config = loadTrustedConfig();
    expect(config.model).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
    expect(config.thinkingBudget).toBeUndefined();
    expect(config.autoEnable).toBeUndefined();
    expect(config.verbose).toBe(true);
  });

  it("overrides take precedence over file config", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ model: "file-model", maxTokens: 2048 }),
    );

    const config = loadTrustedConfig({ model: "override-model" });
    expect(config.model).toBe("override-model");
    expect(config.maxTokens).toBe(2048); // not overridden
  });

  it("merges user profile from both layers", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ user: { name: "Alex" } }),
    );

    const config = loadTrustedConfig({ user: { context: "ML engineer" } });
    expect(config.user?.name).toBe("Alex");
    expect(config.user?.context).toBe("ML engineer");
  });

  it("merges aliases from both layers", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ aliases: { "/research": "Research: ", "/draft": "Draft: " } }),
    );

    const config = loadTrustedConfig({ aliases: { "/research": "Deep research: " } });
    expect(config.aliases?.["/research"]).toBe("Deep research: "); // override
    expect(config.aliases?.["/draft"]).toBe("Draft: ");            // preserved
  });

  it("loads agentModels as a string map", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { builder: "builder-model", explorer: "explorer-model" } }),
    );

    const config = loadTrustedConfig();
    expect(config.agentModels?.builder).toBe("builder-model");
    expect(config.agentModels?.explorer).toBe("explorer-model");
  });

  it("sanitizes agentModels: drops non-string and empty values", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { valid: "valid-model", bad: 42, empty: "" } }),
    );

    const config = loadTrustedConfig();
    expect(config.agentModels?.valid).toBe("valid-model");
    expect(config.agentModels?.bad).toBeUndefined();
    expect(config.agentModels?.empty).toBeUndefined();
  });

  it("merges agentModels across config layers", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { builder: "file-builder-model", explorer: "file-explorer-model" } }),
    );

    const config = loadTrustedConfig({ agentModels: { explorer: "override-explorer-model" } });
    expect(config.agentModels?.builder).toBe("file-builder-model");
    expect(config.agentModels?.explorer).toBe("override-explorer-model");
  });

  it("handles malformed JSON gracefully", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "not json {{{");

    const config = loadConfig(tmpDir, undefined, {
      globalConfigPath: join(tmpDir, "missing-global-config.json"),
    });
    expect(config).toEqual({});
  });

  it("handles non-object JSON gracefully", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify([1, 2, 3]));

    const config = loadConfig(tmpDir, undefined, {
      globalConfigPath: join(tmpDir, "missing-global-config.json"),
    });
    expect(config).toEqual({});
  });

  it("loads autoEnable as array of strings", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ autoEnable: ["web", "code", 42, "", null] }),
    );

    const config = loadTrustedConfig();
    expect(config.autoEnable).toEqual(["web", "code"]); // filters invalid entries
  });

  it("loads serve and cli autonomy defaults", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        serve: { defaultAutonomyMode: "supervised" },
        cli: { defaultAutonomyMode: "passive" },
      }),
    );

    const config = loadTrustedConfig();
    expect(config.serve?.defaultAutonomyMode).toBe("supervised");
    expect(config.cli?.defaultAutonomyMode).toBe("passive");
  });

  it("rejects invalid serve autonomy defaults", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ serve: { defaultAutonomyMode: "banana" } }),
    );

    expect(() => loadTrustedConfig()).toThrow(
      /config\.serve\.defaultAutonomyMode must be one of passive, supervised, autonomous/,
    );
  });

  it("rejects invalid cli autonomy defaults", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ cli: { defaultAutonomyMode: "banana" } }),
    );

    expect(() => loadTrustedConfig()).toThrow(
      /config\.cli\.defaultAutonomyMode must be one of passive, supervised, autonomous/,
    );
  });
});
