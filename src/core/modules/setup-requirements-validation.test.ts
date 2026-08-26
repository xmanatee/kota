import { describe, expect, it } from "vitest";
import type {
  ModuleSetupFormField,
  ModuleSetupRequirement,
} from "./setup-requirements.js";
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

  it("accepts stable option identifiers and rejects secret-shaped option values", () => {
    const withOption = (value: string) => ({
      ...configRequirement(),
      setup: {
        mode: "form" as const,
        fields: [{
          ...configRequirement().setup.fields[0]!,
          options: [{ value, label: "API key profile" }],
        }],
      },
    });

    expect(() =>
      validateModuleSetupRequirements("demo", [withOption("oauth-profile")]),
    ).not.toThrow();
    expect(() =>
      validateModuleSetupRequirements("demo", [withOption("sk-live-secret-1234567890")]),
    ).toThrow(/unsafe option value/);
  });

  it("restricts options to non-empty string-field declarations", () => {
    const requirement = configRequirement();
    const withField = (field: ModuleSetupFormField) => ({
      ...requirement,
      setup: { mode: "form" as const, fields: [field] },
    });
    const base = requirement.setup.fields[0]!;

    expect(() => validateModuleSetupRequirements("demo", [
      withField({ ...base, type: "number", options: [{ value: "1", label: "One" }] }) as ModuleSetupRequirement,
    ])).toThrow(/only declare options for a string field/);
    expect(() => validateModuleSetupRequirements("demo", [
      withField({ ...base, options: [] }) as ModuleSetupRequirement,
    ])).toThrow(/at least one option/);
  });
});
