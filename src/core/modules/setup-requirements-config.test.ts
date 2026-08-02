import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleSetupConfigRequirement } from "./setup-requirements.js";
import {
  configRequirement,
  createModuleSetupTestHarness,
} from "./setup-requirements-test-support.js";

describe("module setup config requirements", () => {
  const harness = createModuleSetupTestHarness();

  beforeEach(() => harness.setup());
  afterEach(() => harness.cleanup());

  it("reports missing config and accepts non-sensitive form setup", async () => {
    const sut = harness.service([configRequirement()]);

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
    const rawConfig = readFileSync(join(harness.projectDir, ".kota", "config.json"), "utf8");
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
    const sut = harness.service([requirement]);

    const rejected = await sut.submitForm("demo", "endpoint", {
      "client-secret-ref": "raw-client-secret",
    });
    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid_request",
      message: expect.stringContaining("secret reference"),
    });
    expect(existsSync(join(harness.projectDir, ".kota", "config.json"))).toBe(false);

    const accepted = await sut.submitForm("demo", "endpoint", {
      "client-secret-ref": "$DEMO_CLIENT_SECRET",
    });
    expect(accepted).toMatchObject({
      ok: true,
      status: { state: "ready" },
    });
    const rawConfig = readFileSync(join(harness.projectDir, ".kota", "config.json"), "utf8");
    expect(rawConfig).toContain("$DEMO_CLIENT_SECRET");
    expect(rawConfig).not.toContain("raw-client-secret");
  });
});
