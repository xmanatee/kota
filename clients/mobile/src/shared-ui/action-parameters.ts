import type {
  UiAction,
  UiFormField,
  UiJsonSchema,
  UiJsonValue,
} from '../daemon/conformance/ui-surface.generated';

export type UiFieldValues = Readonly<Record<string, string | boolean>>;

export function initialFieldValues(
  action: UiAction,
  fields: readonly UiFormField[],
): UiFieldValues {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    const schema = field.schema ?? action.parameters?.schema.properties[field.id];
    const fallback = schemaDefault(schema);
    if (field.input === 'boolean') {
      values[field.id] = fallback === true;
    } else if (fallback !== undefined) {
      values[field.id] =
        typeof fallback === 'string' || typeof fallback === 'number'
          ? String(fallback)
          : JSON.stringify(fallback, null, 2);
    } else {
      values[field.id] = '';
    }
  }
  return values;
}

export function readActionParameters(
  action: UiAction,
  fields: readonly UiFormField[],
  values: UiFieldValues,
  initialParameters: Readonly<Record<string, UiJsonValue>>,
): Readonly<Record<string, UiJsonValue>> | undefined {
  if (fields.length === 0 && Object.keys(initialParameters).length === 0) {
    return undefined;
  }
  const parameters: Record<string, UiJsonValue> = { ...initialParameters };
  for (const field of fields) {
    const value = values[field.id];
    if (field.input === 'boolean') {
      parameters[field.id] = value === true;
      continue;
    }
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw.length === 0) {
      if (field.required) throw new Error(`${field.label} is required.`);
      continue;
    }
    const schema = field.schema ?? action.parameters?.schema.properties[field.id];
    if (
      field.input === 'number' ||
      schema?.type === 'number' ||
      schema?.type === 'integer'
    ) {
      const number = Number(raw);
      if (!Number.isFinite(number)) {
        throw new Error(`${field.label} must be a number.`);
      }
      if (schema?.type === 'integer' && !Number.isInteger(number)) {
        throw new Error(`${field.label} must be an integer.`);
      }
      if (
        (schema?.type === 'number' || schema?.type === 'integer') &&
        schema.minimum !== undefined &&
        number < schema.minimum
      ) {
        throw new Error(`${field.label} must be at least ${schema.minimum}.`);
      }
      if (
        (schema?.type === 'number' || schema?.type === 'integer') &&
        schema.maximum !== undefined &&
        number > schema.maximum
      ) {
        throw new Error(`${field.label} must be at most ${schema.maximum}.`);
      }
      parameters[field.id] = number;
      continue;
    }
    if (schema?.type === 'array' || schema?.type === 'object') {
      let parsed: UiJsonValue;
      try {
        parsed = JSON.parse(raw) as UiJsonValue;
      } catch {
        throw new Error(`${field.label} must be valid JSON.`);
      }
      if (schema.type === 'array' && !Array.isArray(parsed)) {
        throw new Error(`${field.label} must be a JSON array.`);
      }
      if (
        schema.type === 'object' &&
        (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      ) {
        throw new Error(`${field.label} must be a JSON object.`);
      }
      parameters[field.id] = parsed;
      continue;
    }
    parameters[field.id] = raw;
  }
  return parameters;
}

function schemaDefault(
  schema: UiJsonSchema | undefined,
): UiJsonValue | undefined {
  if (!schema || !('default' in schema)) return undefined;
  return schema.default;
}
