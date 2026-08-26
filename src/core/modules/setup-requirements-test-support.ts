import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSecretStores } from "#core/config/secrets.js";
import {
  type ModuleSetupBase,
  type ModuleSetupCapabilityRequirement,
  type ModuleSetupCapabilityStatus,
  type ModuleSetupConfigRequirement,
  type ModuleSetupOAuthRequirement,
  type ModuleSetupRequirement,
  type ModuleSetupRequirementContribution,
  ModuleSetupService,
} from "./setup-requirements.js";

export function configRequirement(): ModuleSetupConfigRequirement {
  const base: ModuleSetupBase = {
    id: "endpoint",
    title: "Endpoint",
    required: true,
    scope: "scope",
  };

  return {
    ...base,
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
}

export function oauthRequirement(
  options: { withHealth?: boolean } = {},
): ModuleSetupOAuthRequirement {
  return {
    id: "oauth",
    kind: "oauth",
    title: "OAuth connection",
    required: true,
    scope: "scope",
    sensitivity: "oauth",
    reauth: true,
    ...(options.withHealth && {
      health: { capabilityIds: ["demo.oauth"] },
    }),
    setup: {
      mode: "url",
      url: "https://auth.example.test/start?state=secret-state&next=/setup",
      label: "Open OAuth",
      pendingTtlMs: 1000,
    },
    secretRefs: [{ name: "DEMO_REFRESH_TOKEN", scope: "scope" }],
  };
}

export function oauthRequirementWithPolicyTtl(): ModuleSetupOAuthRequirement {
  const requirement = oauthRequirement();
  return {
    ...requirement,
    setup: {
      mode: requirement.setup.mode,
      url: requirement.setup.url,
      label: requirement.setup.label,
    },
  };
}

export function capabilityRequirement(): ModuleSetupCapabilityRequirement {
  return {
    id: "runtime",
    kind: "capability",
    title: "Runtime capability",
    required: true,
    scope: "scope",
    sensitivity: "none",
    setup: { mode: "none" },
    capabilityIds: ["demo.runtime"],
  };
}

export type ModuleSetupTestHarness = {
  readonly scopeRoot: string;
  setup(): void;
  cleanup(): void;
  service(requirements: ModuleSetupRequirement[]): ModuleSetupService;
  setNow(now: Date): void;
  setCapabilities(capabilities: ModuleSetupCapabilityStatus[]): void;
};

export function createModuleSetupTestHarness(): ModuleSetupTestHarness {
  let scopeRoot: string | undefined;
  let operatorDir: string | undefined;
  let authorityConfigPath: string | undefined;
  let now = new Date("2026-01-01T00:00:00.000Z");
  let capabilities: ModuleSetupCapabilityStatus[] = [];

  const initializedScopeRoot = (): string => {
    if (scopeRoot === undefined) throw new Error("Module setup test harness is not initialized");
    return scopeRoot;
  };

  return {
    get scopeRoot() {
      return initializedScopeRoot();
    },
    setup() {
      scopeRoot = mkdtempSync(join(tmpdir(), "kota-setup-"));
      operatorDir = mkdtempSync(join(tmpdir(), "kota-setup-authority-"));
      authorityConfigPath = join(operatorDir, "config.json");
      writeFileSync(
        authorityConfigPath,
        JSON.stringify({ trustedScopes: [scopeRoot] }),
      );
      now = new Date("2026-01-01T00:00:00.000Z");
      capabilities = [];
      resetSecretStores();
    },
    cleanup() {
      resetSecretStores();
      if (scopeRoot !== undefined) rmSync(scopeRoot, { recursive: true, force: true });
      if (operatorDir !== undefined) rmSync(operatorDir, { recursive: true, force: true });
      scopeRoot = undefined;
      operatorDir = undefined;
      authorityConfigPath = undefined;
    },
    service(requirements) {
      const contributions: ModuleSetupRequirementContribution[] = requirements.map(
        (requirement) => ({ moduleName: "demo", requirement }),
      );
      return new ModuleSetupService({
        scopeRoot: initializedScopeRoot(),
        authorityConfigPath,
        getRequirements: () => contributions,
        probeCapabilities: async () => capabilities,
        now: () => now,
      });
    },
    setNow(value) {
      now = value;
    },
    setCapabilities(value) {
      capabilities = value;
    },
  };
}
