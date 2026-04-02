/**
 * Minimal JSON Schema validator for workflow trigger payload validation.
 *
 * Supports the subset of JSON Schema most useful for describing workflow payloads:
 * type, properties, required, additionalProperties, items (for arrays).
 *
 * Returns null on success, or a descriptive error string on failure.
 */

type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function formatPathWithDescription(path: string, schema: JsonSchema): string {
  const desc = typeof schema.description === "string" ? ` — ${schema.description}` : "";
  return `${path}${desc}`;
}

function validateValue(schema: JsonSchema, value: unknown, path: string): string | null {
  if (schema.type !== undefined) {
    const expected = schema.type as string | string[];
    const actual = typeOf(value);
    const types = Array.isArray(expected) ? expected : [expected];
    if (!types.includes(actual)) {
      const label = formatPathWithDescription(path, schema);
      return `${label}: expected ${types.join(" | ")}, got ${actual}`;
    }
  }

  if (typeOf(value) === "object" && value !== null) {
    const obj = value as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      const props = schema.properties as Record<string, JsonSchema> | undefined;
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          const propSchema = props?.[key];
          const desc = propSchema && typeof propSchema.description === "string" ? ` — ${propSchema.description}` : "";
          return `${path}: missing required field "${key}"${desc}`;
        }
      }
    }

    if (schema.properties !== undefined) {
      const props = schema.properties as Record<string, JsonSchema>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          const error = validateValue(propSchema, obj[key], `${path}.${key}`);
          if (error) return error;
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys((schema.properties as Record<string, unknown>) ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          return `${path}: unexpected field "${key}"`;
        }
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    const itemSchema = schema.items as JsonSchema;
    for (let i = 0; i < value.length; i++) {
      const error = validateValue(itemSchema, value[i], `${path}[${i}]`);
      if (error) return error;
    }
  }

  return null;
}

export function validatePayloadSchema(
  inputSchema: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | null {
  return validateValue(inputSchema as JsonSchema, payload, "payload");
}
