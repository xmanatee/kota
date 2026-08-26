import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  warnIgnoredUntrustedScopeConfig,
  warnInvalidConcurrencyConfig,
  warnUnknownConfigKeys,
} from "./config-warnings.js";

function makeScopeRoot(): string {
  const dir = join(
    tmpdir(),
    `kota-config-warnings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return realpathSync(dir);
}

describe("warnUnknownConfigKeys", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("emits no warnings when config has only known keys", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "test-model", approvalTtlMs: 60000 }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits a warning for each unknown top-level key", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "test-model", typoKey: true, anotherBadKey: 42 }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"typoKey"');
    expect(warnings[1]).toContain('"anotherBadKey"');
  });

  it("includes the config file path in the warning message", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ badKey: "value" }),
    );
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings[0]).toContain(".kota");
    expect(warnings[0]).toContain("config.json");
  });

  it("emits no warnings when config file does not exist", () => {
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings when config file is not valid JSON", () => {
    writeFileSync(join(scopeRoot, ".kota", "config.json"), "not-json");
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("emits no warnings for an empty config object", () => {
    writeFileSync(join(scopeRoot, ".kota", "config.json"), "{}");
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("suppresses warnings for module-registered keys", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, customModuleKey: true }),
    );
    const moduleKeys = new Set(["scheduler", "customModuleKey"]);
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg), moduleKeys);
    expect(warnings).toHaveLength(0);
  });

  it("still warns for keys not in core or module sets", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, totallyUnknown: 1 }),
    );
    const moduleKeys = new Set(["scheduler"]);
    const warnings: string[] = [];
    warnUnknownConfigKeys(scopeRoot, (msg) => warnings.push(msg), moduleKeys);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"totallyUnknown"');
  });
});

describe("warnIgnoredUntrustedScopeConfig", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("warns with the scope config path and rejected key classes", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({
        guardrails: { toolOverrides: { process: "allow" } },
        skipConfirmations: true,
        defaultAgentHarness: "repo-harness",
        providers: { memory: "repo-memory" },
        foreignModules: [{ transport: "stdio", command: "repo-owned" }],
        serve: { noAuth: true },
        modules: { browser: { storageStatePath: "repo-profile" } },
      }),
    );

    const warnings: string[] = [];
    warnIgnoredUntrustedScopeConfig(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(join(scopeRoot, ".kota", "config.json"));
    expect(warnings[0]).toContain("guardrail policy (guardrails)");
    expect(warnings[0]).toContain("confirmation policy (skipConfirmations)");
    expect(warnings[0]).toContain("harness/preset selection (defaultAgentHarness)");
    expect(warnings[0]).toContain("model/provider routing (providers)");
    expect(warnings[0]).toContain("foreign module launch (foreignModules)");
    expect(warnings[0]).toContain("server/auth posture (serve)");
    expect(warnings[0]).toContain("module config (modules)");
    expect(warnings[0]).toContain("trustedScopes");
  });
});

describe("warnInvalidConcurrencyConfig", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("accepts a positive integer override", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ scheduler: { concurrency: 8 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(0);
  });

  it("reports an invalid override before resolution falls back", () => {
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ scheduler: { concurrency: 0 } }),
    );
    const warnings: string[] = [];
    warnInvalidConcurrencyConfig(scopeRoot, (msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("scheduler.concurrency");
    expect(warnings[0]).toContain("integer from 1 to");
  });
});
