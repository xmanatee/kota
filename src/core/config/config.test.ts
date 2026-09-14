import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type KotaConfig, loadConfigWithDiagnostics } from "./config.js";

describe("layered configuration", () => {
  let root: string;
  let globalConfigPath: string;
  let scopeConfigPath: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-config-"));
    globalConfigPath = join(root, "machine.json");
    mkdirSync(join(root, ".kota"));
    scopeConfigPath = join(root, ".kota", "config.json");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function load(scope: unknown, overrides?: Partial<KotaConfig>, global: Partial<KotaConfig> = {}) {
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [root], ...global }));
    writeFileSync(scopeConfigPath, JSON.stringify(scope));
    return loadConfigWithDiagnostics(root, overrides, { globalConfigPath }).config;
  }

  it("returns empty configuration without either file", () => {
    expect(loadConfigWithDiagnostics(root, undefined, { globalConfigPath }).config).toEqual({});
  });

  it.each(["not json {{{", "[1,2,3]", "null"])("ignores invalid trusted file %s and preserves global configuration", (raw) => {
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [root], model: "machine" }));
    writeFileSync(scopeConfigPath, raw);
    const result = loadConfigWithDiagnostics(root, undefined, { globalConfigPath });
    expect(result.scopeConfigTrust.trusted).toBe(true);
    expect(result.config).toEqual({ trustedScopes: [root], model: "machine" });
  });

  it("applies global, trusted scope and caller precedence while preserving unrelated fields", () => {
    expect(load(
      { model: "scope", maxTokens: 2048, verbose: true },
      { model: "caller" },
      { model: "machine", maxTokens: 4096, thinking: true },
    )).toEqual({ trustedScopes: [root], model: "caller", maxTokens: 2048, verbose: true, thinking: true });
  });

  it("merges nested user and routing maps without replacing untouched entries", () => {
    const result = load({
      user: { name: "Alex" },
      aliases: { "/research": "Research: ", "/draft": "Draft: " },
      agentModels: { builder: "scope-builder", explorer: "scope-explorer" },
      modelOutputTokenLimits: { "scope-model": 12345 },
    }, {
      user: { context: "ML engineer" },
      aliases: { "/research": "Deep research: " },
      agentModels: { explorer: "caller-explorer" },
      modelOutputTokenLimits: { "caller-model": 6789 },
    });
    expect(result).toEqual({
      trustedScopes: [root], user: { name: "Alex", context: "ML engineer" },
      aliases: { "/research": "Deep research: ", "/draft": "Draft: " },
      agentModels: { builder: "scope-builder", explorer: "caller-explorer" },
      modelOutputTokenLimits: { "scope-model": 12345, "caller-model": 6789 },
    });
  });

  it("sanitizes boundary values while preserving valid array and map members", () => {
    expect(load({
      model: 123, maxTokens: -5, thinkingBudget: 100, verbose: true,
      autoEnable: ["web"],
      agentModels: { valid: "model", invalid: 42, empty: "" },
    })).toEqual({ trustedScopes: [root], verbose: true, autoEnable: ["web"], agentModels: { valid: "model" } });

  });

  it("preserves explicit empty scope overrides while omission inherits", () => {
    expect(load({}, undefined, { autoEnable: ["execution"] }).autoEnable).toEqual(["execution"]);
    expect(load({ autoEnable: [] }, undefined, { autoEnable: ["execution"] }).autoEnable).toEqual([]);
  });

  it.each([
    [{ autoEnable: "execution" }, "config.autoEnable"],
    [{ autoEnable: [""] }, "config.autoEnable"],
    [{ modelOutputTokenLimits: { model: 0 } }, "config.modelOutputTokenLimits.model"],
  ])("rejects malformed explicit configuration %j", (value, path) => {
    expect(() => load(value)).toThrow(path);
  });

  it("keeps a valid workflow budget when a caller supplies an invalid replacement", () => {
    expect(load({ workflow: { agentTokenBudget: { maxTotalTokens: 50_000 } } }, {
      workflow: { agentTokenBudget: { maxTotalTokens: 0 } },
    }).workflow?.agentTokenBudget).toEqual({ maxTotalTokens: 50_000 });
  });

  it("selects project verification through trusted configuration precedence", () => {
    const scope = { workflow: { validationCommand: ["python3", "verify.py"] } };
    writeFileSync(scopeConfigPath, JSON.stringify(scope));
    expect(loadConfigWithDiagnostics(root, undefined, { globalConfigPath }).config.workflow).toBeUndefined();
    expect(load(scope, undefined, { workflow: { validationCommand: ["make", "test"] } }).workflow)
      .toEqual(scope.workflow);
    expect(load(scope, { workflow: { validationCommand: ["cargo", "test"] } }).workflow)
      .toEqual({ validationCommand: ["cargo", "test"] });
  });

  it("accepts preparation only through trusted configuration and rejects escaping outputs", () => {
    const preparation = { inputs: ["package.json", "pnpm-lock.yaml"], outputs: ["node_modules"], checkCommand: ["node", "check.mjs"], command: ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"] };
    writeFileSync(scopeConfigPath, JSON.stringify({ workflow: { preparation } }));
    expect(loadConfigWithDiagnostics(root, undefined, { globalConfigPath }).config.workflow).toBeUndefined();
    expect(load({ workflow: { preparation } }).workflow?.preparation).toEqual(preparation);
    for (const outputs of [["../shared"], [".git"], ["node_modules", "node_modules"], ["/tmp"]]) {
      expect(() => load({ workflow: { preparation: { ...preparation, outputs } } })).toThrow("workflow.preparation.outputs");
    }
    expect(() => load({ workflow: { preparation: { ...preparation, command: [] } } })).toThrow("workflow.preparation.command");
  });

  it.each([[], "make test", [""], ["make", 1], null])("rejects a malformed project check without falling back: %j", (validationCommand) => {
    expect(() => load({ workflow: { validationCommand } }, undefined, {
      workflow: { validationCommand: ["make", "test"] },
    })).toThrow("workflow.validationCommand");
  });

  it("propagates separately configured CLI and server autonomy", () => {
    expect(load({ serve: { defaultAutonomyMode: "supervised" }, cli: { defaultAutonomyMode: "passive" } }))
      .toMatchObject({ serve: { defaultAutonomyMode: "supervised" }, cli: { defaultAutonomyMode: "passive" } });
  });

  it.each(["serve", "cli"])("rejects malformed %s autonomy at the file boundary", (surface) => {
    expect(() => load({ [surface]: { defaultAutonomyMode: "banana" } }))
      .toThrow(`config.${surface}.defaultAutonomyMode must be one of`);
  });

  it("accepts machine authority only from persisted global configuration", () => {
    const payload = {
      model: "repo-model", trustedScopes: [root], scopePolicies: "malformed policy",
      scopeAuthority: { revision: 999 }, skipConfirmations: true,
      guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" }, toolOverrides: { process: "allow" } },
      foreignModules: [{ transport: "stdio", command: "repo-owned" }],
    };
    writeFileSync(scopeConfigPath, JSON.stringify(payload));
    const overrides = {
      model: "operator-model", trustedScopes: [root],
      scopePolicies: "malformed caller policy" as never, scopeAuthority: { revision: 999 } as never,
    };
    const untrusted = loadConfigWithDiagnostics(root, overrides, { globalConfigPath });
    expect(untrusted.scopeConfigTrust).toMatchObject({ trusted: false, reason: "untrusted" });
    expect(untrusted.config).toEqual({ model: "operator-model" });
    expect(untrusted.warnings).toHaveLength(1);
    expect(untrusted.warnings[0]).toContain(scopeConfigPath);
    expect(untrusted.warnings[0]).toContain("guardrail policy");

    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [root] }));
    const trusted = loadConfigWithDiagnostics(root, overrides, { globalConfigPath });
    expect(trusted.scopeConfigTrust).toMatchObject({ trusted: true, reason: "trusted-scopes-config" });
    expect(trusted.config).toEqual({
      trustedScopes: [root], model: "operator-model", skipConfirmations: true,
      guardrails: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" }, toolOverrides: { process: "allow" } },
      foreignModules: [{ transport: "stdio", command: "repo-owned" }],
    });
    expect(trusted.warnings).toEqual([]);
  });
});
