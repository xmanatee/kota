export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

export type JsonSchemaObject = { [key: string]: JsonSchemaValue };

function typeOf(value: JsonSchemaValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isSchemaObject(value: JsonSchemaValue | undefined): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSchemaTypes(schema: JsonSchemaObject): string[] {
  const expected = schema.type;
  if (typeof expected === "string") return [expected];
  if (Array.isArray(expected)) {
    const types = expected.filter((item): item is string => typeof item === "string");
    if (types.length === expected.length) return types;
  }
  return [];
}

function formatPathWithDescription(path: string, schema: JsonSchemaObject): string {
  const desc = typeof schema.description === "string" ? ` — ${schema.description}` : "";
  return `${path}${desc}`;
}

function validateValue(schema: JsonSchemaObject, value: JsonSchemaValue, path: string): string | null {
  const types = readSchemaTypes(schema);
  if (types.length > 0) {
    const actual = typeOf(value);
    if (!types.includes(actual)) {
      const label = formatPathWithDescription(path, schema);
      return `${label}: expected ${types.join(" | ")}, got ${actual}`;
    }
  }

  if (isSchemaObject(value)) {
    const props = isSchemaObject(schema.properties) ? schema.properties : undefined;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key !== "string") continue;
        if (!(key in value)) {
          const propSchema = props?.[key];
          const desc = isSchemaObject(propSchema) && typeof propSchema.description === "string"
            ? ` — ${propSchema.description}`
            : "";
          return `${path}: missing required field "${key}"${desc}`;
        }
      }
    }

    if (props) {
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in value && isSchemaObject(propSchema)) {
          const error = validateValue(propSchema, value[key], `${path}.${key}`);
          if (error) return error;
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(props ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          return `${path}: unexpected field "${key}"`;
        }
      }
    }
  }

  if (Array.isArray(value) && isSchemaObject(schema.items)) {
    for (let i = 0; i < value.length; i++) {
      const error = validateValue(schema.items, value[i], `${path}[${i}]`);
      if (error) return error;
    }
  }

  return null;
}

export function validateJsonSchemaValue(
  schema: JsonSchemaObject,
  value: JsonSchemaValue,
  rootLabel: string,
): string | null {
  return validateValue(schema, value, rootLabel);
}
