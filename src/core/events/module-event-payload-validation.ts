import type {
  ModuleEventPayloadObject,
  ModuleEventPayloadSchema,
  ModuleEventPayloadValue,
  ModuleEventSchemaNode,
  ModuleEventSchemaProperties,
} from "./module-event-schema.js";

export function validatePayloadAgainstSchema(
  schema: ModuleEventPayloadSchema,
  payload: ModuleEventPayloadObject,
): string | null {
  return validateObjectProperties(
    schema.properties,
    schema.additionalProperties === true,
    payload,
    "payload",
  );
}

function validateNode(
  schema: ModuleEventSchemaNode,
  value: ModuleEventPayloadValue,
  path: string,
): string | null {
  if (value === null) {
    if (schema.type === "json" || schema.nullable === true) return null;
    return `${path} must be ${schema.type}, got null`;
  }

  if (schema.type === "json") {
    return isJsonValue(value) ? null : `${path} must be JSON-compatible`;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return `${path} must be string, got ${valueKind(value)}`;
    if (schema.enum && !schema.enum.includes(value)) {
      return `${path} must be one of ${schema.enum.join(", ")}`;
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      return `${path} must be an ISO date-time string`;
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        return `${path} must be a URI string`;
      }
    }
    return null;
  }

  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${path} must be number, got ${valueKind(value)}`;
    }
    return null;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      return `${path} must be boolean, got ${valueKind(value)}`;
    }
    return null;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be array, got ${valueKind(value)}`;
    for (let index = 0; index < value.length; index++) {
      const error = validateNode(schema.items, value[index]!, `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }

  if (schema.type === "discriminatedUnion") {
    if (!isPayloadObject(value)) return `${path} must be object, got ${valueKind(value)}`;
    const discriminator = value[schema.discriminator];
    if (typeof discriminator !== "string") {
      return `${path}.${schema.discriminator} must be a string discriminator`;
    }
    const variant = schema.variants[discriminator];
    if (!variant) {
      return `${path}.${schema.discriminator} must be one of ${Object.keys(schema.variants).join(", ")}`;
    }
    return validateObjectProperties(
      variant.properties,
      variant.additionalProperties === true,
      value,
      path,
    );
  }

  if (!isPayloadObject(value)) return `${path} must be object, got ${valueKind(value)}`;
  return validateObjectProperties(
    schema.properties,
    schema.additionalProperties === true,
    value,
    path,
  );
}

function validateObjectProperties(
  properties: ModuleEventSchemaProperties,
  allowAdditional: boolean,
  payload: ModuleEventPayloadObject,
  path: string,
): string | null {
  for (const [field, schema] of Object.entries(properties)) {
    const value = payload[field];
    if (value === undefined) {
      if (schema.required === false) continue;
      return `${path}.${field} is required`;
    }
    const error = validateNode(schema, value, `${path}.${field}`);
    if (error) return error;
  }

  if (!allowAdditional) {
    for (const field of Object.keys(payload)) {
      if (properties[field] === undefined) {
        return `${path}.${field} is not declared by the event schema`;
      }
    }
  }
  return null;
}

function isPayloadObject(
  value: ModuleEventPayloadValue,
): value is ModuleEventPayloadObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: ModuleEventPayloadValue): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (!isPayloadObject(value)) return false;
  return Object.values(value).every((entry) => entry !== undefined && isJsonValue(entry));
}

function valueKind(value: ModuleEventPayloadValue): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}
