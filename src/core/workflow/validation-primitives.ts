import { isAbsolute } from "node:path";
import type { ModelTiers } from "../model/model-router.js";
import type { Preset } from "../model/preset.js";
import type { WorkflowFilterValue } from "./trigger-types.js";

export class WorkflowDefinitionError extends Error {
  constructor(message: string, readonly definitionPath: string) {
    super(`${definitionPath}: ${message}`);
    this.name = "WorkflowDefinitionError";
  }
}

export type WorkflowValidationOptions = {
  /**
   * Fallback harness name for agent steps that omit `harness`. When both the
   * step and this field are undefined the validator rejects the step — there
   * is no implicit default harness in code.
   */
  defaultAgentHarness?: string;
  /**
   * Active preset bundle. Supplies the per-tier baseline that operator
   * `modelTiers` overrides extend. When unset, the validator falls back to
   * the shipped `DEFAULT_MODEL_TIERS` (claude). Pass the resolved preset to
   * make tier resolution honor the active preset's tiers without per-step
   * edits.
   */
  preset?: Preset;
  /**
   * Per-tier model id overrides consulted when an agent step declares
   * `tier` instead of a literal `model`. When `preset` is set these
   * overrides win on a per-tier basis; otherwise they extend the shipped
   * default tier mapping.
   */
  modelTiers?: ModelTiers;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function expectRelativePath(value: unknown, field: string, definitionPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty relative path`,
      definitionPath,
    );
  }
  const trimmed = value.trim();
  if (isAbsolute(trimmed)) {
    throw new WorkflowDefinitionError(
      `${field} must be project-relative, not absolute`,
      definitionPath,
    );
  }
  return trimmed;
}

export function expectName(value: unknown, field: string, definitionPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty string`,
      definitionPath,
    );
  }
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw new WorkflowDefinitionError(
      `${field} must match /^[a-z0-9][a-z0-9-]*$/`,
      definitionPath,
    );
  }
  return trimmed;
}

export function expectNonEmptyString(
  value: unknown,
  field: string,
  definitionPath: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowDefinitionError(
      `${field} must be a non-empty string`,
      definitionPath,
    );
  }
  return value.trim();
}

export function expectOptionalString(
  value: unknown,
  field: string,
  definitionPath: string,
): string | undefined {
  if (value === undefined) return undefined;
  return expectNonEmptyString(value, field, definitionPath);
}

export function expectOptionalBoolean(
  value: unknown,
  field: string,
  definitionPath: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new WorkflowDefinitionError(`${field} must be a boolean`, definitionPath);
  }
  return value;
}

export function expectOptionalInteger(
  value: unknown,
  field: string,
  definitionPath: string,
  minimum = 0,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new WorkflowDefinitionError(
      `${field} must be an integer >= ${minimum}`,
      definitionPath,
    );
  }
  return value as number;
}

export function expectOptionalPositiveNumber(
  value: unknown,
  field: string,
  definitionPath: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new WorkflowDefinitionError(
      `${field} must be a positive number`,
      definitionPath,
    );
  }
  return value;
}

export function expectOptionalStringArray(
  value: unknown,
  field: string,
  definitionPath: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new WorkflowDefinitionError(
      `${field} must be an array of non-empty strings`,
      definitionPath,
    );
  }
  return value.map((item) => item.trim());
}

export function expectOptionalScalarFilter(
  value: unknown,
  field: string,
  definitionPath: string,
): Record<string, WorkflowFilterValue> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  const filter: Record<string, WorkflowFilterValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const values = Array.isArray(entry) ? entry : [entry];
    if (
      values.length === 0 ||
      values.some(
        (current) =>
          typeof current !== "string" &&
          typeof current !== "number" &&
          typeof current !== "boolean",
      )
    ) {
      throw new WorkflowDefinitionError(
        `${field}.${key} must be a scalar or non-empty array of scalars`,
        definitionPath,
      );
    }
    filter[key] = Array.isArray(entry)
      ? [...values]
      : (entry as WorkflowFilterValue);
  }
  return filter;
}

export function expectOptionalObjectOrFunction(
  value: unknown,
  field: string,
  definitionPath: string,
): Record<string, unknown> | ((...args: never[]) => unknown) | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "function") return value as (...args: never[]) => unknown;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(
      `${field} must be an object or function`,
      definitionPath,
    );
  }
  return value;
}

export function expectOptionalFunction(
  value: unknown,
  field: string,
  definitionPath: string,
): ((...args: never[]) => unknown) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function") {
    throw new WorkflowDefinitionError(`${field} must be a function`, definitionPath);
  }
  return value as (...args: never[]) => unknown;
}

/**
 * Reject any keys on `value` that aren't in `allowedKeys`. Used to keep
 * nested definition blocks strictly in sync with their TypeScript contract —
 * silently ignoring unknown keys lets removed fields linger in the runtime
 * parser after the type contract drops them.
 */
export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  field: string,
  definitionPath: string,
): void {
  const allowed = new Set<string>(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new WorkflowDefinitionError(
      `${field} has unknown key(s): ${unknown.map((k) => `"${k}"`).join(", ")}`,
      definitionPath,
    );
  }
}
