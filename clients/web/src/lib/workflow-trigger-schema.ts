/**
 * Helpers for turning a workflow definition's `inputSchema` (a small
 * JSON Schema subset emitted by the daemon's
 * `WorkflowDefinitionSummary`) into the data the trigger form needs:
 * a stable list of fields, a strict TypeScript representation of the
 * draft values, and a payload assembler that returns either a typed
 * payload or a list of validation errors.
 *
 * Only the subset the daemon actually uses is supported (object root
 * with `properties` and optional `required`; string/number/boolean
 * leaf types). Unknown leaf types render as text inputs and are sent
 * back as strings — the daemon validates the final shape, so the
 * client does not need a full schema engine.
 */

export type TriggerFieldType = "string" | "number" | "boolean" | "unknown";

export type TriggerField = {
  name: string;
  type: TriggerFieldType;
  required: boolean;
  description?: string;
};

export type TriggerFieldValue = string | number | boolean | "";

export type TriggerDraft = Record<string, TriggerFieldValue>;

export type TriggerAssembleResult =
  | { ok: true; payload: Record<string, string | number | boolean> }
  | { ok: false; errors: Record<string, string> };

const SUPPORTED_TYPES: ReadonlySet<TriggerFieldType> = new Set([
  "string",
  "number",
  "boolean",
]);

/**
 * Returns the ordered list of fields the form should render. An
 * absent / unparseable schema yields an empty list, which the caller
 * treats as "no input required" so the trigger fires immediately.
 */
export function parseTriggerFields(
  schema: Record<string, unknown> | undefined,
): TriggerField[] {
  if (!schema) return [];
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  const requiredRaw = schema.required;
  const required = new Set<string>(
    Array.isArray(requiredRaw)
      ? requiredRaw.filter((r): r is string => typeof r === "string")
      : [],
  );
  const fields: TriggerField[] = [];
  for (const [name, raw] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    const prop = isRecord(raw) ? raw : {};
    const declaredType = typeof prop.type === "string" ? prop.type : "unknown";
    const type: TriggerFieldType = SUPPORTED_TYPES.has(
      declaredType as TriggerFieldType,
    )
      ? (declaredType as TriggerFieldType)
      : "unknown";
    const description =
      typeof prop.description === "string" ? prop.description : undefined;
    fields.push({
      name,
      type,
      required: required.has(name),
      ...(description !== undefined && { description }),
    });
  }
  return fields;
}

/** Initial draft values for a field set. */
export function emptyDraft(fields: TriggerField[]): TriggerDraft {
  const draft: TriggerDraft = {};
  for (const field of fields) {
    draft[field.name] = field.type === "boolean" ? false : "";
  }
  return draft;
}

/**
 * Assemble the form draft into the payload object the trigger
 * endpoint expects. Required fields must be present and (for numbers)
 * parse as finite numbers; any failure aggregates into `errors`
 * keyed by field name so the form can render per-field validation.
 */
export function assembleTriggerPayload(
  fields: TriggerField[],
  draft: TriggerDraft,
): TriggerAssembleResult {
  const payload: Record<string, string | number | boolean> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = draft[field.name];
    if (field.type === "boolean") {
      if (typeof raw !== "boolean") {
        errors[field.name] = "Expected a boolean value.";
        continue;
      }
      payload[field.name] = raw;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : String(raw ?? "");
    if (text === "") {
      if (field.required) {
        errors[field.name] = "Required.";
      }
      continue;
    }
    if (field.type === "number") {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        errors[field.name] = "Expected a number.";
        continue;
      }
      payload[field.name] = parsed;
      continue;
    }
    payload[field.name] = text;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
