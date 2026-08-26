import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ModuleSetupConfigRequirement,
  ModuleSetupRequirementContribution,
} from "./setup-requirements.js";
import { ModuleSetupService } from "./setup-requirements.js";

const requirement: ModuleSetupConfigRequirement = {
  id: "endpoint",
  title: "Endpoint",
  required: true,
  scope: "scope",
  kind: "config",
  sensitivity: "none",
  setup: {
    mode: "form",
    fields: [
      {
        id: "base-url",
        label: "Base URL",
        type: "string",
        configPath: "modules.demo.baseUrl",
        required: true,
      },
    ],
  },
};

describe("module setup scope policy", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const scopeRoot of scopeRoots.splice(0)) {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });

  it("applies live visibility to reads and mutations", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-setup-policy-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-policy-authority-"));
    const authorityConfigPath = join(operatorDir, "config.json");
    scopeRoots.push(scopeRoot, operatorDir);
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [scopeRoot] }));
    let visibility: "hidden" | "metadata" | "full" = "hidden";
    const contributions: ModuleSetupRequirementContribution[] = [
      { moduleName: "demo", requirement },
    ];
    const service = new ModuleSetupService({
      scopeRoot,
      authorityConfigPath,
      getRequirements: () => contributions,
      probeCapabilities: async () => [],
      getVisibility: () => visibility,
    });

    expect(await service.list()).toMatchObject({ visibility: "hidden", requirements: [] });
    expect(await service.submitForm("demo", "endpoint", {
      "base-url": "https://hidden.test",
    })).toMatchObject({ ok: false, reason: "policy_denied" });

    visibility = "metadata";
    const metadata = await service.list();
    expect(metadata.visibility).toBe("metadata");
    expect(metadata.requirements[0]).toMatchObject({
      moduleName: "demo",
      title: "Endpoint",
      setup: { mode: "none" },
      state: "missing",
    });
    expect(metadata.requirements[0]).not.toHaveProperty("configFields");
    expect(await service.submitForm("demo", "endpoint", {
      "base-url": "https://metadata.test",
    })).toMatchObject({ ok: false, reason: "policy_denied" });

    visibility = "full";
    expect((await service.list()).visibility).toBe("full");
    expect(await service.submitForm("demo", "endpoint", {
      "base-url": "https://full.test",
    })).toMatchObject({ ok: true, status: { state: "ready" } });
  });

  it("uses machine authority instead of trusting scope config unconditionally", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-setup-untrusted-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-untrusted-authority-"));
    const authorityConfigPath = join(operatorDir, "config.json");
    scopeRoots.push(scopeRoot, operatorDir);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(join(scopeRoot, ".kota", "config.json"), JSON.stringify({
      modules: { demo: { baseUrl: "https://malicious.test" } },
      trustedScopes: [scopeRoot],
    }));
    writeFileSync(authorityConfigPath, "{}\n");
    const service = new ModuleSetupService({
      scopeRoot,
      authorityConfigPath,
      getRequirements: () => [{ moduleName: "demo", requirement }],
      probeCapabilities: async () => [],
    });

    expect(await service.list()).toMatchObject({
      requirements: [{ state: "missing", configFields: [{ present: false }] }],
    });

    writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [scopeRoot] }));
    expect(await service.list()).toMatchObject({
      requirements: [{ state: "ready", configFields: [{ present: true }] }],
    });
  });
});
