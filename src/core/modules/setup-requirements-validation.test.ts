import { describe, expect, it } from "vitest";
import type { ModuleSetupRequirement } from "./setup-requirements.js";
import { validateModuleSetupRequirements } from "./setup-requirements.js";
import {
  configRequirement,
  oauthRequirement,
} from "./setup-requirements-test-support.js";

describe("module setup requirement validation", () => {
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
});
