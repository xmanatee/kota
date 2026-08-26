import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigWithDiagnostics } from "./config.js";

describe("scope config machine authority", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const scopeRoot of scopeRoots.splice(0)) {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("never parses or accepts authority from trusted scope config", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-config-authority-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-config-operator-"));
    const globalConfigPath = join(operatorDir, "config.json");
    scopeRoots.push(scopeRoot, operatorDir);
    const configDir = join(scopeRoot, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: "project-model",
        trustedScopes: ["/repo-controlled"],
        scopePolicies: "malformed repo-controlled policy",
        scopeAuthority: { revision: 999 },
      }),
    );

    const bypassAttempt = loadConfigWithDiagnostics(scopeRoot, {
      trustedScopes: [scopeRoot],
      scopePolicies: "malformed caller policy" as never,
      scopeAuthority: { revision: 999 } as never,
    }, { globalConfigPath });
    expect(bypassAttempt.scopeConfigTrust).toMatchObject({
      trusted: false,
      reason: "untrusted",
    });
    expect(bypassAttempt.config.model).toBeUndefined();
    expect(bypassAttempt.config.trustedScopes).toBeUndefined();
    expect(bypassAttempt.config.scopePolicies).toBeUndefined();
    expect(bypassAttempt.config.scopeAuthority).toBeUndefined();

    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [scopeRoot] }));
    const trusted = loadConfigWithDiagnostics(scopeRoot, undefined, {
      globalConfigPath,
    });
    expect(trusted.scopeConfigTrust).toMatchObject({
      trusted: true,
      reason: "trusted-scopes-config",
    });
    expect(trusted.config.model).toBe("project-model");
    expect(trusted.config.trustedScopes).toEqual([scopeRoot]);
    expect(trusted.config.scopePolicies).toBeUndefined();
    expect(trusted.config.scopeAuthority).toBeUndefined();
  });
});
