export type ModuleEventSensitivity = "public" | "internal" | "sensitive" | "secret";

export type ModuleEventCompatibilityPolicy = "none" | "backward";

export type ModuleEventWorkflowTriggerPolicy = "allowed" | "blocked";

export type ModuleEventPayloadObject = {
  readonly [key: string]: ModuleEventPayloadValue | undefined;
};

export type ModuleEventPayloadValue =
  | string
  | number
  | boolean
  | null
  | readonly ModuleEventPayloadValue[]
  | ModuleEventPayloadObject;

type ModuleEventSchemaBase = {
  readonly required?: boolean;
  readonly nullable?: boolean;
  readonly sensitivity?: ModuleEventSensitivity;
  readonly filterable?: boolean;
  readonly description?: string;
};

export type ModuleEventObjectSchemaNode = ModuleEventSchemaBase & {
  readonly type: "object";
  readonly properties: ModuleEventSchemaProperties;
  readonly additionalProperties?: boolean;
};

export type ModuleEventDiscriminatedUnionSchemaNode = ModuleEventSchemaBase & {
  readonly type: "discriminatedUnion";
  readonly discriminator: string;
  readonly variants: {
    readonly [discriminatorValue: string]: ModuleEventObjectSchemaNode;
  };
};

export type ModuleEventSchemaNode =
  | (ModuleEventSchemaBase & {
      readonly type: "string";
      readonly enum?: readonly string[];
      readonly format?: "date-time" | "uri";
    })
  | (ModuleEventSchemaBase & {
      readonly type: "number";
    })
  | (ModuleEventSchemaBase & {
      readonly type: "boolean";
    })
  | (ModuleEventSchemaBase & {
      readonly type: "array";
      readonly items: ModuleEventSchemaNode;
    })
  | ModuleEventObjectSchemaNode
  | ModuleEventDiscriminatedUnionSchemaNode
  | (ModuleEventSchemaBase & {
      readonly type: "json";
    });

export type ModuleEventSchemaProperties = {
  readonly [key: string]: ModuleEventSchemaNode;
};

export type ModuleEventPayloadSchema = {
  readonly type: "object";
  readonly properties: ModuleEventSchemaProperties;
  readonly additionalProperties?: boolean;
};

export type ModuleEventSchema = {
  readonly currentVersion: number;
  readonly payload: ModuleEventPayloadSchema;
};

export type ModuleEventPayloadExample<TPayload extends object = object> = {
  readonly name: string;
  readonly payload: TPayload;
};

export type ModuleEventOptions<TPayload extends object> = {
  readonly schemaVersion?: number;
  readonly payloadSchema?: ModuleEventPayloadSchema;
  readonly filterablePaths?: readonly string[];
  readonly sensitivity?: ModuleEventSensitivity;
  readonly compatibility?: ModuleEventCompatibilityPolicy;
  readonly workflowTriggerPolicy?: ModuleEventWorkflowTriggerPolicy;
  readonly examples?: readonly ModuleEventPayloadExample<TPayload>[];
  readonly normalizeExternal?: (input: ModuleEventPayloadObject) => TPayload;
};

export type ModuleEventSchemaContract<TPayload extends object> = {
  readonly schema: ModuleEventSchema;
  readonly filterablePaths: readonly string[];
  readonly sensitivity: ModuleEventSensitivity;
  readonly compatibility: ModuleEventCompatibilityPolicy;
  readonly workflowTriggerPolicy: ModuleEventWorkflowTriggerPolicy;
  readonly examples: readonly ModuleEventPayloadExample<TPayload>[];
  readonly normalizeExternal?: (input: ModuleEventPayloadObject) => TPayload;
};

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_EVENT_SENSITIVITY: ModuleEventSensitivity = "internal";
const DEFAULT_COMPATIBILITY: ModuleEventCompatibilityPolicy = "backward";
const DEFAULT_WORKFLOW_TRIGGER_POLICY: ModuleEventWorkflowTriggerPolicy = "allowed";

export function buildModuleEventSchemaContract<TPayload extends object>(
  eventName: string,
  fields: readonly string[],
  options?: ModuleEventOptions<TPayload>,
): ModuleEventSchemaContract<TPayload> {
  const schemaVersion = normalizeSchemaVersion(options?.schemaVersion, eventName);
  const payloadSchema = options?.payloadSchema ?? payloadSchemaFromFields(fields);
  assertPayloadSchema(payloadSchema, `Module event "${eventName}" payload schema`);
  const filterablePaths =
    options?.filterablePaths?.map((field) => field.trim()) ??
    deriveFilterablePaths(payloadSchema);
  const schema = {
    currentVersion: schemaVersion,
    payload: payloadSchema,
  } satisfies ModuleEventSchema;
  validateModuleEventDeclaration(eventName, fields, schema, filterablePaths);
  const base = {
    schema,
    filterablePaths,
    sensitivity: options?.sensitivity ?? DEFAULT_EVENT_SENSITIVITY,
    compatibility: options?.compatibility ?? DEFAULT_COMPATIBILITY,
    workflowTriggerPolicy:
      options?.workflowTriggerPolicy ?? DEFAULT_WORKFLOW_TRIGGER_POLICY,
    examples: options?.examples ?? [],
  };
  if (options?.normalizeExternal) {
    return { ...base, normalizeExternal: options.normalizeExternal };
  }
  return base;
}

function normalizeSchemaVersion(value: number | undefined, eventName: string): number {
  if (value === undefined) return DEFAULT_SCHEMA_VERSION;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Module event "${eventName}" schemaVersion must be a positive integer`,
    );
  }
  return value;
}

function payloadSchemaFromFields(fields: readonly string[]): ModuleEventPayloadSchema {
  const properties: { [key: string]: ModuleEventSchemaNode } = {};
  for (const field of fields) {
    properties[field] = { type: "json" };
  }
  return {
    type: "object",
    properties,
    additionalProperties: true,
  };
}

/** Runtime decoder shared by declaration helpers and installed-module admission. */
export function validateModuleEventDeclaration(
  name: unknown,
  fields: unknown,
  schema: unknown,
  filterablePaths: unknown,
): void {
  if (typeof name !== "string" || name.trim() !== name || name.length === 0) {
    throw new Error("Module event name must be a non-empty trimmed string");
  }
  assertStringList(fields, `Module event "${name}" fields`);
  assertRecord(schema, `Module event "${name}" schema`);
  assertKnownKeys(
    schema,
    new Set(["currentVersion", "payload"]),
    `Module event "${name}" schema`,
  );
  if (!Number.isInteger(schema.currentVersion) || (schema.currentVersion as number) < 1) {
    throw new Error(`Module event "${name}" schema currentVersion must be a positive integer`);
  }
  assertPayloadSchema(schema.payload, `Module event "${name}" payload schema`);
  assertStringList(filterablePaths, `Module event "${name}" filterablePaths`);
  const seenFields = new Set<string>();
  for (const field of fields) {
    if (!field) throw new Error(`Module event "${name}" fields must be non-empty strings`);
    if (seenFields.has(field)) {
      throw new Error(`Module event "${name}" declares duplicate field "${field}"`);
    }
    seenFields.add(field);
    if (!schemaPathExists(schema.payload, field)) {
      throw new Error(
        `Module event "${name}" field "${field}" is not present in the payload schema`,
      );
    }
  }

  const seenFilterPaths = new Set<string>();
  for (const path of filterablePaths) {
    if (!path) {
      throw new Error(
        `Module event "${name}" filterablePaths must be non-empty strings`,
      );
    }
    if (seenFilterPaths.has(path)) {
      throw new Error(
        `Module event "${name}" declares duplicate filterable path "${path}"`,
      );
    }
    seenFilterPaths.add(path);
    if (!schemaPathExists(schema.payload, path)) {
      throw new Error(
        `Module event "${name}" filterable path "${path}" is not present in the payload schema`,
      );
    }
  }
}

function assertStringList(
  value: unknown,
  label: string,
): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() !== entry || entry.length === 0) {
      throw new Error(`${label} must contain non-empty trimmed strings`);
    }
  }
}

const EVENT_SENSITIVITIES = new Set<ModuleEventSensitivity>([
  "public",
  "internal",
  "sensitive",
  "secret",
]);

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertPayloadSchema(
  value: unknown,
  label: string,
): asserts value is ModuleEventPayloadSchema {
  assertRecord(value, label);
  assertKnownKeys(value, new Set(["type", "properties", "additionalProperties"]), label);
  if (value.type !== "object") throw new Error(`${label}.type must be "object"`);
  assertSchemaProperties(value.properties, `${label}.properties`, new WeakSet());
  if (
    value.additionalProperties !== undefined &&
    typeof value.additionalProperties !== "boolean"
  ) {
    throw new Error(`${label}.additionalProperties must be a boolean when declared`);
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field "${key}"`);
  }
}

function assertSchemaProperties(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>,
): asserts value is ModuleEventSchemaProperties {
  assertRecord(value, label);
  if (ancestors.has(value)) throw new Error(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    for (const [name, node] of Object.entries(value)) {
      if (name.trim() !== name || name.length === 0) {
        throw new Error(`${label} keys must be non-empty trimmed strings`);
      }
      assertSchemaNode(node, `${label}.${name}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function assertSchemaNode(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>,
): asserts value is ModuleEventSchemaNode {
  assertRecord(value, label);
  if (ancestors.has(value)) throw new Error(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    for (const field of ["required", "nullable", "filterable"] as const) {
      if (value[field] !== undefined && typeof value[field] !== "boolean") {
        throw new Error(`${label}.${field} must be a boolean when declared`);
      }
    }
    if (value.description !== undefined && typeof value.description !== "string") {
      throw new Error(`${label}.description must be a string when declared`);
    }
    if (
      value.sensitivity !== undefined &&
      (typeof value.sensitivity !== "string" ||
        !EVENT_SENSITIVITIES.has(value.sensitivity as ModuleEventSensitivity))
    ) {
      throw new Error(`${label}.sensitivity is invalid`);
    }

    switch (value.type) {
      case "string": {
        assertKnownKeys(
          value,
          new Set([
            "type",
            "required",
            "nullable",
            "sensitivity",
            "filterable",
            "description",
            "enum",
            "format",
          ]),
          label,
        );
        if (value.enum !== undefined) {
          if (
            !Array.isArray(value.enum) ||
            value.enum.some((entry) => typeof entry !== "string")
          ) {
            throw new Error(`${label}.enum must be an array of strings when declared`);
          }
        }
        if (
          value.format !== undefined &&
          value.format !== "date-time" &&
          value.format !== "uri"
        ) {
          throw new Error(`${label}.format is invalid`);
        }
        return;
      }
      case "number":
      case "boolean":
      case "json":
        assertKnownKeys(
          value,
          new Set([
            "type",
            "required",
            "nullable",
            "sensitivity",
            "filterable",
            "description",
          ]),
          label,
        );
        return;
      case "array":
        assertKnownKeys(
          value,
          new Set([
            "type",
            "required",
            "nullable",
            "sensitivity",
            "filterable",
            "description",
            "items",
          ]),
          label,
        );
        assertSchemaNode(value.items, `${label}.items`, ancestors);
        return;
      case "object":
        assertKnownKeys(
          value,
          new Set([
            "type",
            "required",
            "nullable",
            "sensitivity",
            "filterable",
            "description",
            "properties",
            "additionalProperties",
          ]),
          label,
        );
        assertSchemaProperties(value.properties, `${label}.properties`, ancestors);
        if (
          value.additionalProperties !== undefined &&
          typeof value.additionalProperties !== "boolean"
        ) {
          throw new Error(`${label}.additionalProperties must be a boolean when declared`);
        }
        return;
      case "discriminatedUnion": {
        assertKnownKeys(
          value,
          new Set([
            "type",
            "required",
            "nullable",
            "sensitivity",
            "filterable",
            "description",
            "discriminator",
            "variants",
          ]),
          label,
        );
        if (
          typeof value.discriminator !== "string" ||
          value.discriminator.trim() !== value.discriminator ||
          value.discriminator.length === 0
        ) {
          throw new Error(`${label}.discriminator must be a non-empty trimmed string`);
        }
        assertRecord(value.variants, `${label}.variants`);
        if (Object.keys(value.variants).length === 0) {
          throw new Error(`${label}.variants must not be empty`);
        }
        for (const [name, variant] of Object.entries(value.variants)) {
          if (name.trim() !== name || name.length === 0) {
            throw new Error(`${label}.variants keys must be non-empty trimmed strings`);
          }
          assertSchemaNode(variant, `${label}.variants.${name}`, ancestors);
          if (variant.type !== "object") {
            throw new Error(`${label}.variants.${name}.type must be "object"`);
          }
        }
        return;
      }
      default:
        throw new Error(`${label}.type is invalid`);
    }
  } finally {
    ancestors.delete(value);
  }
}

function schemaPathExists(schema: ModuleEventPayloadSchema, path: string): boolean {
  return schemaNodeAtPath(schema, path) !== undefined;
}

function schemaNodeAtPath(
  schema: ModuleEventPayloadSchema,
  path: string,
): ModuleEventSchemaNode | undefined {
  return schemaNodeAtSegments(schema.properties, path.split("."), 0);
}

function schemaNodeAtSegments(
  properties: ModuleEventSchemaProperties,
  segments: readonly string[],
  index: number,
): ModuleEventSchemaNode | undefined {
  const segment = segments[index];
  if (segment === undefined) return undefined;
  const node = properties[segment];
  if (!node) return undefined;
  if (index === segments.length - 1) return node;
  if (node.type === "object") {
    return schemaNodeAtSegments(node.properties, segments, index + 1);
  }
  if (node.type !== "discriminatedUnion") return undefined;
  for (const variant of Object.values(node.variants)) {
    const variantNode = schemaNodeAtSegments(variant.properties, segments, index + 1);
    if (variantNode) return variantNode;
  }
  return undefined;
}

function deriveFilterablePaths(schema: ModuleEventPayloadSchema): string[] {
  const out: string[] = [];
  collectFilterablePaths(schema.properties, "", out);
  return [...new Set(out)];
}

function collectFilterablePaths(
  properties: ModuleEventSchemaProperties,
  prefix: string,
  out: string[],
): void {
  for (const [name, node] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (node.type === "object") {
      if (node.filterable === true) out.push(path);
      collectFilterablePaths(node.properties, path, out);
      continue;
    }
    if (node.type === "discriminatedUnion") {
      if (node.filterable === true) out.push(path);
      for (const variant of Object.values(node.variants)) {
        collectFilterablePaths(variant.properties, path, out);
      }
      continue;
    }
    if (node.filterable === false) continue;
    if (isFilterableNode(node)) out.push(path);
  }
}

function isFilterableNode(node: ModuleEventSchemaNode): boolean {
  if (
    node.type === "string" ||
    node.type === "number" ||
    node.type === "boolean" ||
    node.type === "json"
  ) {
    return true;
  }
  if (node.type !== "array") return false;
  return (
    node.items.type === "string" ||
    node.items.type === "number" ||
    node.items.type === "boolean" ||
    node.items.type === "json"
  );
}
