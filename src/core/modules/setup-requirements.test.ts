import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSecretStore } from "#core/config/secrets.js";
import {
  type ModuleSetupCapabilityRequirement,
  type ModuleSetupCapabilityStatus,
  type ModuleSetupConfigRequirement,
  type ModuleSetupOAuthRequirement,
  type ModuleSetupRequirement,
  type ModuleSetupRequirementContribution,
  ModuleSetupService,
  validateModuleSetupRequirements,
} from "./setup-requirements.js";

function configRequirement(): ModuleSetupConfigRequirement {
  return {
    id: "endpoint",
    kind: "config",
    title: "Endpoint",
    required: true,
    scope: "project",
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

function oauthRequirement(options: { withHealth?: boolean } = {}): ModuleSetupOAuthRequirement {
  return {
    id: "oauth",
    kind: "oauth",
    title: "OAuth connection",
    required: true,
    scope: "project",
    sensitivity: "oauth",
    reauth: true,
    ...(options.withHealth && {
      health: { capabilityIds: ["demo.oauth"] },
    }),
    setup: {
      mode: "url",
      url: "https://auth.example.test/start",
      label: "Open OAuth",
      pendingTtlMs: 1000,
    },
    secretRefs: [{ name: "DEMO_REFRESH_TOKEN", scope: "project" }],
  };
}

function capabilityRequirement(): ModuleSetupCapabilityRequirement {
  return {
    id: "runtime",
    kind: "capability",
    title: "Runtime capability",
    required: true,
    scope: "project",
    sensitivity: "none",
    setup: { mode: "none" },
    capabilityIds: ["demo.runtime"],
  };
}

describe("module setup requirements", () => {
  let projectDir: string;
  let now: Date;
  let capabilities: ModuleSetupCapabilityStatus[];

  function service(
    requirements: ModuleSetupRequirement[],
  ): ModuleSetupService {
    const contributions: ModuleSetupRequirementContribution[] = requirements.map(
      (requirement) => ({ moduleName: "demo", requirement }),
    );
    return new ModuleSetupService({
      projectDir,
      getRequirements: () => contributions,
      probeCapabilities: async () => capabilities,
      now: () => now,
    });
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-setup-"));
    now = new Date("2026-01-01T00:00:00.000Z");
    capabilities = [];
    resetSecretStore();
  });

  afterEach(() => {
    resetSecretStore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("validates ids, duplicates, form fields, and secret refs", () => {
    expect(() => validateModuleSetupRequirements("demo", [configRequirement()])).not.toThrow();
    expect(() =>
      validateModuleSetupRequirements("demo", [
        configRequirement(),
        { ...configRequirement(), title: "Duplicate" },
      ]),
    ).toThrow(/duplicate setup requirement id/);
    expect(() =>
      validateModuleSetupRequirements("demo", [
        {
          ...configRequirement(),
          setup: {
            mode: "form",
            fields: [
              {
                id: "bad-field",
                label: "Bad",
                type: "string",
                configPath: "modules..bad",
                required: true,
              },
            ],
          },
        },
      ]),
    ).toThrow(/invalid config path/);
    expect(() =>
      validateModuleSetupRequirements("demo", [
        { ...oauthRequirement(), secretRefs: [] },
      ]),
    ).toThrow(/at least one secret ref/);
  });

  it("rejects unknown setup declaration literals at runtime", () => {
    expect(() =>
      validateModuleSetupRequirements("demo", [
        { ...configRequirement(), kind: "unknown-kind" } as unknown as ModuleSetupRequirement,
      ]),
    ).toThrow(/unknown kind/);
    expect(() =>
      validateModuleSetupRequirements("demo", [
        { ...configRequirement(), scope: "workspace" } as unknown as ModuleSetupRequirement,
      ]),
    ).toThrow(/unknown scope/);
    expect(() =>
      validateModuleSetupRequirements("demo", [
        { ...configRequirement(), sensitivity: "token" } as unknown as ModuleSetupRequirement,
      ]),
    ).toThrow(/unknown sensitivity/);
    expect(() =>
      validateModuleSetupRequirements("demo", [
        {
          ...configRequirement(),
          setup: { mode: "prompt", fields: [] },
        } as unknown as ModuleSetupRequirement,
      ]),
    ).toThrow(/unknown setup mode/);
  });

  it("reports missing config and accepts non-sensitive form setup", async () => {
    const sut = service([configRequirement()]);

    const before = await sut.list();
    expect(before.requirements[0]?.state).toBe("missing");
    expect(before.requirements[0]?.configFields?.[0]).toMatchObject({
      configPath: "modules.demo.baseUrl",
      present: false,
    });

    const result = await sut.submitForm("demo", "endpoint", {
      "base-url": "https://demo.example.test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.state).toBe("ready");
      expect(result.status.configFields?.[0]?.present).toBe(true);
    }
    const rawConfig = readFileSync(join(projectDir, ".kota", "config.json"), "utf8");
    expect(rawConfig).toContain("https://demo.example.test");
  });

  it("rejects raw secrets for form fields that require secret references", async () => {
    const requirement: ModuleSetupConfigRequirement = {
      ...configRequirement(),
      setup: {
        mode: "form",
        fields: [
          {
            id: "client-secret-ref",
            label: "Client secret reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.demo.clientSecret",
            required: true,
          },
        ],
      },
    };
    const sut = service([requirement]);

    const rejected = await sut.submitForm("demo", "endpoint", {
      "client-secret-ref": "raw-client-secret",
    });
    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("secret reference"),
    });
    expect(existsSync(join(projectDir, ".kota", "config.json"))).toBe(false);

    const accepted = await sut.submitForm("demo", "endpoint", {
      "client-secret-ref": "$DEMO_CLIENT_SECRET",
    });
    expect(accepted).toMatchObject({
      ok: true,
      status: { state: "ready" },
    });
    const rawConfig = readFileSync(join(projectDir, ".kota", "config.json"), "utf8");
    expect(rawConfig).toContain("$DEMO_CLIENT_SECRET");
    expect(rawConfig).not.toContain("raw-client-secret");
  });

  it("starts and completes sensitive OAuth setup without returning secret values", async () => {
    const sut = service([oauthRequirement()]);

    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    expect(started.action.url).toBe("https://auth.example.test/start");
    expect(started.status.state).toBe("pending");

    const completed = await sut.complete(started.action.actionId, {
      secretValues: { DEMO_REFRESH_TOKEN: "refresh-token-secret-123" },
    });
    expect(JSON.stringify(completed)).not.toContain("refresh-token-secret-123");
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.status.state).toBe("ready");
      expect(completed.status.secretRefs).toEqual([
        {
          name: "DEMO_REFRESH_TOKEN",
          scope: "project",
          present: true,
          source: "project-file",
        },
      ]);
    }
  });

  it("reports expired URL setup for reauth-capable OAuth requirements", async () => {
    const sut = service([oauthRequirement()]);
    const started = await sut.start("demo", "oauth");
    expect(started.ok).toBe(true);

    now = new Date("2026-01-01T00:00:02.000Z");
    const listed = await sut.list();
    expect(listed.requirements[0]).toMatchObject({
      kind: "oauth",
      sensitivity: "oauth",
      state: "expired",
      reason: "url_setup_expired",
    });
  });

  it("reports stored OAuth credentials as expired when readiness detects refresh failure", async () => {
    const sut = service([oauthRequirement({ withHealth: true })]);
    capabilities = [{
      id: "demo.oauth",
      status: "unavailable",
      reason: "oauth_refresh_failed",
      message: "OAuth token refresh failed; reauthorization is required.",
    }];

    const stored = await sut.storeSecret("demo", "oauth", {
      DEMO_REFRESH_TOKEN: "refresh-token-secret-789",
    });

    expect(stored).toMatchObject({
      ok: true,
      status: {
        state: "expired",
        reason: "oauth_refresh_failed",
      },
    });
    const listed = await sut.list();
    expect(listed.requirements[0]).toMatchObject({
      kind: "oauth",
      state: "expired",
      secretRefs: [{ name: "DEMO_REFRESH_TOKEN", present: true }],
      capabilities: [{
        id: "demo.oauth",
        status: "unavailable",
        reason: "oauth_refresh_failed",
      }],
    });
    expect(JSON.stringify(listed)).not.toContain("refresh-token-secret-789");
  });

  it("revokes stored credentials and records a revoked state", async () => {
    const sut = service([oauthRequirement()]);
    const stored = await sut.storeSecret("demo", "oauth", {
      DEMO_REFRESH_TOKEN: "refresh-token-secret-456",
    });
    expect(stored.ok).toBe(true);

    const revoked = await sut.revoke("demo", "oauth");
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.status.state).toBe("revoked");
      expect(revoked.status.pendingAction?.status).toBe("revoked");
    }

    const listed = await sut.list();
    expect(listed.requirements[0]?.state).toBe("revoked");
    expect(JSON.stringify(listed)).not.toContain("refresh-token-secret-456");
  });

  it("updates capability readiness from the probe source", async () => {
    const sut = service([capabilityRequirement()]);

    capabilities = [
      {
        id: "demo.runtime",
        status: "unavailable",
        reason: "missing_setup",
        message: "Credential is missing.",
      },
    ];
    expect((await sut.list()).requirements[0]).toMatchObject({
      state: "unavailable",
      reason: "capability_unavailable",
    });

    capabilities = [{ id: "demo.runtime", status: "ready" }];
    expect((await sut.refresh("demo", "runtime"))).toMatchObject({
      ok: true,
      status: { state: "ready", reason: "capability_ready" },
    });
  });
});
