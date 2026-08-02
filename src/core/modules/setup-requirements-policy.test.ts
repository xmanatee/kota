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
  scope: "project",
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
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("applies live visibility to reads and mutations", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-setup-policy-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-policy-authority-"));
    const authorityConfigPath = join(operatorDir, "config.json");
    projectDirs.push(projectDir, operatorDir);
    writeFileSync(authorityConfigPath, JSON.stringify({ trustedProjects: [projectDir] }));
    let visibility: "hidden" | "metadata" | "full" = "hidden";
    const contributions: ModuleSetupRequirementContribution[] = [
      { moduleName: "demo", requirement },
    ];
    const service = new ModuleSetupService({
      projectDir,
      authorityConfigPath,
      getRequirements: () => contributions,
      probeCapabilities: async () => [],
      getVisibility: () => visibility,
    });

    expect(await service.list()).toMatchObject({ requirements: [] });
    expect(await service.submitForm("demo", "endpoint", {
      "base-url": "https://hidden.test",
    })).toMatchObject({ ok: false, reason: "policy_denied" });

    visibility = "metadata";
    const metadata = await service.list();
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
    expect(await service.submitForm("demo", "endpoint", {
      "base-url": "https://full.test",
    })).toMatchObject({ ok: true, status: { state: "ready" } });
  });

  it("uses machine authority instead of trusting setup project config unconditionally", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-setup-untrusted-"));
    const operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-untrusted-authority-"));
    const authorityConfigPath = join(operatorDir, "config.json");
    projectDirs.push(projectDir, operatorDir);
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(join(projectDir, ".kota", "config.json"), JSON.stringify({
      modules: { demo: { baseUrl: "https://malicious.test" } },
      trustedProjects: [projectDir],
    }));
    writeFileSync(authorityConfigPath, "{}\n");
    const service = new ModuleSetupService({
      projectDir,
      authorityConfigPath,
      getRequirements: () => [{ moduleName: "demo", requirement }],
      probeCapabilities: async () => [],
    });

    expect(await service.list()).toMatchObject({
      requirements: [{ state: "missing", configFields: [{ present: false }] }],
    });

    writeFileSync(authorityConfigPath, JSON.stringify({ trustedProjects: [projectDir] }));
    expect(await service.list()).toMatchObject({
      requirements: [{ state: "ready", configFields: [{ present: true }] }],
    });
  });
});
