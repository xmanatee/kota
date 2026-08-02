import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigWithDiagnostics } from "./config.js";

describe("project config machine authority", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("never parses or accepts authority from trusted project config", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-config-authority-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-config-operator-"));
    const globalConfigPath = join(operatorDir, "config.json");
    projectDirs.push(projectDir, operatorDir);
    const configDir = join(projectDir, ".kota");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: "project-model",
        trustedProjects: ["/repo-controlled"],
        scopePolicies: "malformed repo-controlled policy",
        scopeAuthority: { revision: 999 },
      }),
    );

    const bypassAttempt = loadConfigWithDiagnostics(projectDir, {
      trustedProjects: [projectDir],
      scopePolicies: "malformed caller policy" as never,
      scopeAuthority: { revision: 999 } as never,
    }, { globalConfigPath });
    expect(bypassAttempt.projectConfigTrust).toMatchObject({
      trusted: false,
      reason: "untrusted",
    });
    expect(bypassAttempt.config.model).toBeUndefined();
    expect(bypassAttempt.config.trustedProjects).toBeUndefined();
    expect(bypassAttempt.config.scopePolicies).toBeUndefined();
    expect(bypassAttempt.config.scopeAuthority).toBeUndefined();

    writeFileSync(globalConfigPath, JSON.stringify({ trustedProjects: [projectDir] }));
    const trusted = loadConfigWithDiagnostics(projectDir, undefined, {
      globalConfigPath,
    });
    expect(trusted.projectConfigTrust).toMatchObject({
      trusted: true,
      reason: "trusted-projects-config",
    });
    expect(trusted.config.model).toBe("project-model");
    expect(trusted.config.trustedProjects).toEqual([projectDir]);
    expect(trusted.config.scopePolicies).toBeUndefined();
    expect(trusted.config.scopeAuthority).toBeUndefined();
  });
});
