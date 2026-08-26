import { redactSensitiveValues } from "#core/evidence/policy.js";
import {
  FORM_FIELD_TYPES,
  ID_PATTERN,
  SETUP_KINDS,
  SETUP_MODES,
  SETUP_OPTION_VALUE_PATTERN,
  SETUP_SCOPES,
  SETUP_SENSITIVITIES,
} from "./constants.js";
import type {
  ModuleSetupBrowserProfileRequirement,
  ModuleSetupConfigRequirement,
  ModuleSetupExternalUrlRequirement,
  ModuleSetupOAuthRequirement,
  ModuleSetupRequirement,
  ModuleSetupSecretRef,
  ModuleSetupSecretRequirement,
  ModuleSetupSensitivity,
} from "./types.js";

export function validateModuleSetupRequirements(
  moduleName: string,
  requirements: readonly ModuleSetupRequirement[],
): void {
  const seen = new Set<string>();
  for (const req of requirements) {
    validateCommon(moduleName, req, seen);
    switch (req.kind) {
      case "config":
        validateKindShape(moduleName, req, "none", "form");
        validateFormRequirement(moduleName, req);
        break;
      case "secret":
        validateKindShape(moduleName, req, "secret", "url");
        validateUrlRequirement(moduleName, req);
        validateSecretRefs(moduleName, req.id, req.secretRefs);
        break;
      case "oauth":
        validateKindShape(moduleName, req, "oauth", "url");
        validateUrlRequirement(moduleName, req);
        validateSecretRefs(moduleName, req.id, req.secretRefs);
        break;
      case "browser-profile":
        validateKindShape(moduleName, req, "browser-profile", "form");
        validateFormRequirement(moduleName, req);
        validateConfigPath(moduleName, req.id, req.storageStateConfigPath);
        break;
      case "external-url":
        validateExternalUrlShape(moduleName, req.id, req.sensitivity, req.setup.mode);
        validateUrlRequirement(moduleName, req);
        if (req.secretRefs) validateSecretRefs(moduleName, req.id, req.secretRefs);
        for (const path of req.completionConfigPaths ?? []) {
          validateConfigPath(moduleName, req.id, path);
        }
        break;
      case "capability":
        validateKindShape(moduleName, req, "none", "none");
        if (req.capabilityIds.length === 0) {
          throw new Error(
            `Module "${moduleName}" setup requirement "${req.id}" must declare at least one capability id`,
          );
        }
        break;
    }
  }
}

export function isLiteral<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return allowed.includes(value as T);
}

function isSafeModuleSetupOptionValue(value: string): boolean {
  return SETUP_OPTION_VALUE_PATTERN.test(value) && redactSensitiveValues(value) === value;
}

function validateExternalUrlShape(
  moduleName: string,
  requirementId: string,
  sensitivity: ModuleSetupSensitivity,
  setupMode: ModuleSetupRequirement["setup"]["mode"],
): void {
  if (sensitivity === "browser-profile") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" with kind "external-url" cannot use "browser-profile" sensitivity`,
    );
  }
  if (setupMode !== "url") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" must use url setup`,
    );
  }
}

function validateCommon(
  moduleName: string,
  req: ModuleSetupRequirement,
  seen: Set<string>,
): void {
  const setup = req.setup;
  if (!isLiteral(req.kind, SETUP_KINDS)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown kind "${req.kind}"`,
    );
  }
  if (!isLiteral(req.scope, SETUP_SCOPES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown scope "${req.scope}"`,
    );
  }
  if (!isLiteral(req.sensitivity, SETUP_SENSITIVITIES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown sensitivity "${req.sensitivity}"`,
    );
  }
  if (typeof setup !== "object" || setup === null) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare setup`,
    );
  }
  if (!isLiteral(setup.mode, SETUP_MODES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown setup mode "${setup.mode}"`,
    );
  }
  if (!ID_PATTERN.test(req.id)) {
    throw new Error(
      `Module "${moduleName}" setup requirement id "${req.id}" must match ${ID_PATTERN.source}`,
    );
  }
  if (seen.has(req.id)) {
    throw new Error(
      `Module "${moduleName}" declares duplicate setup requirement id "${req.id}"`,
    );
  }
  seen.add(req.id);
  if (req.title.trim() === "") {
    throw new Error(`Module "${moduleName}" setup requirement "${req.id}" title is empty`);
  }
  for (const capabilityId of req.health?.capabilityIds ?? []) {
    if (capabilityId.trim() === "") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" has an empty health capability id`,
      );
    }
  }
}

function validateKindShape(
  moduleName: string,
  req: ModuleSetupRequirement,
  sensitivity: ModuleSetupSensitivity,
  setupMode: ModuleSetupRequirement["setup"]["mode"],
): void {
  if (req.sensitivity !== sensitivity) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" with kind "${req.kind}" must use "${sensitivity}" sensitivity`,
    );
  }
  if (req.setup.mode !== setupMode) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" with kind "${req.kind}" must use "${setupMode}" setup`,
    );
  }
}

function validateFormRequirement(
  moduleName: string,
  req: ModuleSetupConfigRequirement | ModuleSetupBrowserProfileRequirement,
): void {
  if (req.setup.fields.length === 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare at least one form field`,
    );
  }
  const fieldIds = new Set<string>();
  for (const field of req.setup.fields) {
    if (!ID_PATTERN.test(field.id)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field id "${field.id}" must match ${ID_PATTERN.source}`,
      );
    }
    if (fieldIds.has(field.id)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" declares duplicate field "${field.id}"`,
      );
    }
    fieldIds.add(field.id);
    if (!isLiteral(field.type, FORM_FIELD_TYPES)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has unknown type "${field.type}"`,
      );
    }
    if (field.valueKind !== undefined && field.valueKind !== "secret-reference") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has unknown valueKind "${field.valueKind}"`,
      );
    }
    if (field.valueKind === "secret-reference" && field.type !== "string") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" must be a string to accept secret references`,
      );
    }
    if (field.options !== undefined && field.type !== "string") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" can only declare options for a string field`,
      );
    }
    if (field.options !== undefined && field.options.length === 0) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" must declare at least one option`,
      );
    }
    const optionValues = new Set<string>();
    for (const option of field.options ?? []) {
      if (!isSafeModuleSetupOptionValue(option.value)) {
        throw new Error(
          `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has an unsafe option value`,
        );
      }
      if (optionValues.has(option.value)) {
        throw new Error(
          `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" declares a duplicate option value`,
        );
      }
      optionValues.add(option.value);
      if (option.label.trim() === "") {
        throw new Error(
          `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has an empty option label`,
        );
      }
    }
    validateConfigPath(moduleName, req.id, field.configPath);
  }
}

function validateUrlRequirement(
  moduleName: string,
  req:
    | ModuleSetupSecretRequirement
    | ModuleSetupOAuthRequirement
    | ModuleSetupExternalUrlRequirement,
): void {
  if (req.setup.url.trim() === "" || req.setup.label.trim() === "") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare a URL and label`,
    );
  }
  if (req.setup.pendingTtlMs !== undefined && req.setup.pendingTtlMs <= 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" pendingTtlMs must be positive`,
    );
  }
}

function validateSecretRefs(
  moduleName: string,
  requirementId: string,
  refs: readonly ModuleSetupSecretRef[],
): void {
  if (refs.length === 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" must declare at least one secret ref`,
    );
  }
  for (const ref of refs) {
    if (ref.name.trim() === "") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${requirementId}" has an empty secret name`,
      );
    }
  }
}

function validateConfigPath(
  moduleName: string,
  requirementId: string,
  path: string,
): void {
  if (path.split(".").some((part) => part.trim() === "")) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" has invalid config path "${path}"`,
    );
  }
}
