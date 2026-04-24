import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KNOWN_CONFIG_KEYS, warnInvalidConcurrencyConfig, warnUnknownConfigKeys } from "./config-warnings.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-config-warnings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return realpathSync(dir);
}

describe("warnUnknownConfigKeys", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits no warnings when config has only known keys", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", approvalTtlMs: 60000 }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits a warning for each unknown top-level key", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", typoKey: true, anotherBadKey: 42 }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"typoKey"');
    expect(warnings[1]).toContain('"anotherBadKey"');
  });

  it("includes the config file path in the warning message", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ badKey: "value" }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings[0]).toContain(".kota");
    expect(warnings[0]).toContain("config.json");
  });

  it("emits no warnings when config file does not exist", () => {
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings when config file is not valid JSON", () => {
    writeFileSync(join(projectDir, ".kota", "config.json"), "not-json");
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings for an empty config object", () => {
    writeFileSync(join(projectDir, ".kota", "config.json"), "{}");
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("suppresses warnings for module-registered keys", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, customModuleKey: true }),
    );
    const moduleKeys = new Set(["scheduler", "customModuleKey"]);
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg), moduleKeys);
    expect(warnings).toHaveLength(0);
  });

  it("still warns for keys not in core or module sets", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, totallyUnknown: 1 }),
    );
    const moduleKeys = new Set(["scheduler"]);
    const warnings: string[] = [];
    warnUnknownConfigKeys(projectDir, (msg) => warnings.push(msg), moduleKeys);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"totallyUnknown"');
  });
});

describe("KNOWN_CONFIG_KEYS", () => {
  it("contains the core-owned keys", () => {
    const expected = [
      "model", "editorModel", "maxTokens", "thinking", "thinkingBudget",
      "verbose", "skipConfirmations", "autoEnable", "user", "aliases", "reflection",
      "guardrails", "modules", "foreignModules", "providers", "modelProvider",
      "modelTiers", "agentModels", "approvalTtlMs",
      "runsGc", "serve", "cli", "log", "daemon", "notifications", "workflow",
      "moduleMonitoring",
    ];
    for (const key of expected) {
      expect(KNOWN_CONFIG_KEYS.has(key), `missing key: ${key}`).toBe(true);
    }
  });

  it("does not contain module-registered keys", () => {
    for (const key of ["scheduler", "webhooks", "mcp"]) {
      expect(KNOWN_CONFIG_KEYS.has(key), `should not contain module key: ${key}`).toBe(false);
    }
  });
});

describe("warnInvalidConcurrencyConfig", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits no warnings for valid positive integer concurrency values", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 2, codeConcurrency: 8 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("warns for zero agentConcurrency", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 0 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("agentConcurrency");
    expect(warnings[0]).toContain("positive integer");
  });

  it("warns for negative codeConcurrency", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { codeConcurrency: -1 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("codeConcurrency");
  });

  it("warns for non-integer value", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: 1.5 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("agentConcurrency");
  });

  it("warns for non-number value", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { agentConcurrency: "two" } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("agentConcurrency");
  });

  it("emits no warnings when config file does not exist", () => {
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings when scheduler key is absent", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6" }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings when concurrency keys are absent from scheduler", () => {
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: { dispatchWindow: { start: "09:00", end: "18:00" } } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(projectDir, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });
});
