import { Script } from "node:vm";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonSchemaObject, JsonSchemaValue } from "./json-schema-validator.js";

const validators = new WeakMap<object, (value: JsonSchemaValue, path: string) => string | null>();

const boundedCall = new Script("run()");
const COMPILE_TIMEOUT_MS = 250;
const VALIDATE_TIMEOUT_MS = 50;

// A timer cannot interrupt synchronous validation. V8's execution deadline also
// interrupts host callbacks, including reference expansion and regular expressions.
// This is a work limit, not a security sandbox for running peer-supplied code.
function withinDeadline<T>(run: () => T, timeout: number): T {
  try {
    return boundedCall.runInNewContext({run}, {timeout}) as T;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      throw new Error("JSON Schema exceeded execution time limit");
    }
    throw error;
  }
}

/** Compile offline: unresolved network references fail without fetching them. */
export function compileJsonSchema2020(schema: object): (value: JsonSchemaValue, path: string) => string | null {
  const cached = validators.get(schema);
  if (cached) return cached;
  let nodes = 0;
  const bound = (value: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 64) throw new Error("JSON Schema exceeds validation limits");
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) { for (const item of value) bound(item, depth + 1); }
    else { for (const item of Object.values(value)) bound(item, depth + 1); }
  };
  bound(schema, 0);
  const declared = (schema as Record<string, unknown>).$schema;
  if (declared !== undefined && declared !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`Unsupported JSON Schema dialect: ${String(declared)}`);
  }
  if ((schema as Record<string, unknown>).$async !== undefined) throw new Error("Asynchronous JSON Schemas are unsupported");
  // Unknown annotation keywords are permitted by JSON Schema. No loadSchema,
  // mutation, coercion, defaults, or remote-reference resolver is installed.
  const validate = withinDeadline(() => {
    const ajv = new Ajv2020({strict: false, validateFormats: false, allErrors: false, addUsedSchema: false});
    return ajv.compile(schema);
  }, COMPILE_TIMEOUT_MS);
  const validator = (value: JsonSchemaValue, path: string): string | null => {
    try {
      if (withinDeadline(() => validate(value), VALIDATE_TIMEOUT_MS)) return null;
      const error = validate.errors?.[0];
      return `${path}${error?.instancePath ?? ""}: ${error?.message ?? "does not match schema"}`;
    } catch (error) {
      return `${path}: validation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  validators.set(schema, validator);
  return validator;
}

export function validateJsonSchema2020(schema: JsonSchemaObject, value: JsonSchemaValue, path: string): string | null {
  try { return compileJsonSchema2020(schema)(value, path); }
  catch (error) { return `${path}: invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`; }
}
