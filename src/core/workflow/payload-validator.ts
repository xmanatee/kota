import {
  type JsonSchemaObject,
  validateJsonSchemaValue,
} from "#core/util/json-schema-validator.js";

export function validatePayloadSchema(
  inputSchema: Record<string, unknown>,
  payload: Record<string, unknown>,
  rootLabel = "payload",
): string | null {
  return validateJsonSchemaValue(
    inputSchema as JsonSchemaObject,
    payload as JsonSchemaObject,
    rootLabel,
  );
}
