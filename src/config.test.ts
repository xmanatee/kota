import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUserProfile, expandAlias, type KotaConfig, loadConfig } from "./config.js";

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

  it("returns empty config when no files exist", () => {
    const config = loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("loads project config from .kota/config.json", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ model: "claude-opus-4-6", maxTokens: 4096 }),
    );

    const config = loadConfig(tmpDir);
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.maxTokens).toBe(4096);
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
        architect: "yes",      // wrong type
        autoEnable: "web",     // not an array
        verbose: true,         // valid
      }),
    );

    const config = loadConfig(tmpDir);
    expect(config.model).toBeUndefined();
    expect(config.maxTokens).toBeUndefined();
    expect(config.thinkingBudget).toBeUndefined();
    expect(config.architect).toBeUndefined();
    expect(config.autoEnable).toBeUndefined();
    expect(config.verbose).toBe(true);
  });

  it("overrides take precedence over file config", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ model: "claude-haiku-4-5-20251001", maxTokens: 2048 }),
    );

    const config = loadConfig(tmpDir, { model: "claude-opus-4-6" });
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.maxTokens).toBe(2048); // not overridden
  });

  it("merges user profile from both layers", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ user: { name: "Alex" } }),
    );

    const config = loadConfig(tmpDir, { user: { context: "ML engineer" } });
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

    const config = loadConfig(tmpDir, { aliases: { "/research": "Deep research: " } });
    expect(config.aliases?.["/research"]).toBe("Deep research: "); // override
    expect(config.aliases?.["/draft"]).toBe("Draft: ");            // preserved
  });

  it("loads agentModels as a string map", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { builder: "claude-opus-4-6", explorer: "claude-haiku-4-5-20251001" } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.agentModels?.builder).toBe("claude-opus-4-6");
    expect(config.agentModels?.explorer).toBe("claude-haiku-4-5-20251001");
  });

  it("sanitizes agentModels: drops non-string and empty values", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { valid: "claude-opus-4-6", bad: 42, empty: "" } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.agentModels?.valid).toBe("claude-opus-4-6");
    expect(config.agentModels?.bad).toBeUndefined();
    expect(config.agentModels?.empty).toBeUndefined();
  });

  it("merges agentModels across config layers", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ agentModels: { builder: "claude-opus-4-6", explorer: "claude-sonnet-4-6" } }),
    );

    const config = loadConfig(tmpDir, { agentModels: { explorer: "claude-haiku-4-5-20251001" } });
    expect(config.agentModels?.builder).toBe("claude-opus-4-6");      // from file
    expect(config.agentModels?.explorer).toBe("claude-haiku-4-5-20251001"); // overridden
  });

  it("handles malformed JSON gracefully", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "not json {{{");

    const config = loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("handles non-object JSON gracefully", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify([1, 2, 3]));

    const config = loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("loads autoEnable as array of strings", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ autoEnable: ["web", "code", 42, "", null] }),
    );

    const config = loadConfig(tmpDir);
    expect(config.autoEnable).toEqual(["web", "code"]); // filters invalid entries
  });

  it("loads scheduler.agentConcurrency and scheduler.codeConcurrency", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 2, codeConcurrency: 8 } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.scheduler?.agentConcurrency).toBe(2);
    expect(config.scheduler?.codeConcurrency).toBe(8);
  });

  it("ignores scheduler.agentConcurrency when invalid (zero, negative, non-integer)", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });

    for (const val of [0, -1, 1.5, "two"]) {
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({ scheduler: { agentConcurrency: val } }),
      );
      const config = loadConfig(tmpDir);
      expect(config.scheduler?.agentConcurrency).toBeUndefined();
    }
  });

  it("ignores scheduler.codeConcurrency when invalid", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ scheduler: { codeConcurrency: 0 } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.scheduler?.codeConcurrency).toBeUndefined();
  });

  it("preserves other scheduler keys when concurrency values are invalid", () => {
    const configDir = join(tmpDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 0, dispatchWindow: { start: "09:00", end: "18:00" } } }),
    );

    const config = loadConfig(tmpDir);
    expect(config.scheduler?.agentConcurrency).toBeUndefined();
    expect(config.scheduler?.dispatchWindow).toBeDefined();
  });
});

describe("buildUserProfile", () => {
  it("returns empty string when no user config", () => {
    expect(buildUserProfile({} as KotaConfig)).toBe("");
  });

  it("builds profile with name only", () => {
    const result = buildUserProfile({ user: { name: "Alex" } } as KotaConfig);
    expect(result).toContain("**User**: Alex");
    expect(result).toContain("## User Profile");
  });

  it("builds profile with name and context", () => {
    const result = buildUserProfile({
      user: { name: "Alex", context: "Senior ML engineer, prefers Python" },
    } as KotaConfig);
    expect(result).toContain("**User**: Alex");
    expect(result).toContain("Senior ML engineer, prefers Python");
  });

  it("builds profile with context only", () => {
    const result = buildUserProfile({
      user: { context: "Works on data pipelines" },
    } as KotaConfig);
    expect(result).not.toContain("**User**");
    expect(result).toContain("Works on data pipelines");
  });
});

describe("expandAlias", () => {
  const aliases: Record<string, string> = {
    "/research": "Enable web tools and thoroughly research: ",
    "/draft": "Draft a well-structured document about: ",
    "/review": "Review this code for bugs and best practices: ",
  };

  it("expands a matching alias", () => {
    const result = expandAlias("/research quantum computing", aliases);
    expect(result).toBe("Enable web tools and thoroughly research: quantum computing");
  });

  it("returns original prompt when no alias matches", () => {
    const result = expandAlias("just a normal prompt", aliases);
    expect(result).toBe("just a normal prompt");
  });

  it("handles alias with no trailing text", () => {
    const result = expandAlias("/research", aliases);
    expect(result).toBe("Enable web tools and thoroughly research:");
  });

  it("does not expand partial matches", () => {
    const result = expandAlias("/researching things", aliases);
    expect(result).toBe("/researching things");
  });

  it("returns original when aliases is undefined", () => {
    const result = expandAlias("/research stuff", undefined);
    expect(result).toBe("/research stuff");
  });
});
