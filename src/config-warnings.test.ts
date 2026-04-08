import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KNOWN_CONFIG_KEYS, warnUnknownConfigKeys } from "./config-warnings.js";

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
      JSON.stringify({ model: "claude-sonnet-4-6", dailyBudgetUsd: 5 }),
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
});

describe("KNOWN_CONFIG_KEYS", () => {
  it("contains the full set of expected keys", () => {
    const expected = [
      "model", "editorModel", "maxTokens", "architect", "thinking", "thinkingBudget",
      "verbose", "skipConfirmations", "autoEnable", "user", "aliases", "reflection",
      "guardrails", "extensions", "foreignExtensions", "providers", "modelProvider",
      "modelTiers", "agentModels", "webhooks", "approvalTtlMs", "dailyBudgetUsd",
      "runsGc", "serve", "log", "daemon", "notifications",
    ];
    for (const key of expected) {
      expect(KNOWN_CONFIG_KEYS.has(key), `missing key: ${key}`).toBe(true);
    }
  });
});
