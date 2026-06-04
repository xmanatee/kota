export type ModuleEventSensitivity = "public" | "internal" | "sensitive" | "secret";

export type ModuleEventCompatibilityPolicy = "none" | "backward";

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
  readonly examples?: readonly ModuleEventPayloadExample<TPayload>[];
  readonly normalizeExternal?: (input: ModuleEventPayloadObject) => TPayload;
};

export type ModuleEventSchemaContract<TPayload extends object> = {
  readonly schema: ModuleEventSchema;
  readonly filterablePaths: readonly string[];
  readonly sensitivity: ModuleEventSensitivity;
  readonly compatibility: ModuleEventCompatibilityPolicy;
  readonly examples: readonly ModuleEventPayloadExample<TPayload>[];
  readonly normalizeExternal?: (input: ModuleEventPayloadObject) => TPayload;
};

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_EVENT_SENSITIVITY: ModuleEventSensitivity = "internal";
const DEFAULT_COMPATIBILITY: ModuleEventCompatibilityPolicy = "backward";

export function buildModuleEventSchemaContract<TPayload extends object>(
  eventName: string,
  fields: readonly string[],
  options?: ModuleEventOptions<TPayload>,
): ModuleEventSchemaContract<TPayload> {
  const schemaVersion = normalizeSchemaVersion(options?.schemaVersion, eventName);
  const payloadSchema = options?.payloadSchema ?? payloadSchemaFromFields(fields);
  const filterablePaths =
    options?.filterablePaths?.map((field) => field.trim()) ??
    deriveFilterablePaths(payloadSchema);
  validateModuleEventDeclaration(eventName, fields, payloadSchema, filterablePaths);
  const base = {
    schema: {
      currentVersion: schemaVersion,
      payload: payloadSchema,
    },
    filterablePaths,
    sensitivity: options?.sensitivity ?? DEFAULT_EVENT_SENSITIVITY,
    compatibility: options?.compatibility ?? DEFAULT_COMPATIBILITY,
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

function validateModuleEventDeclaration(
  name: string,
  fields: readonly string[],
  payloadSchema: ModuleEventPayloadSchema,
  filterablePaths: readonly string[],
): void {
  if (!name.trim()) throw new Error("Module event name must be a non-empty string");
  const seenFields = new Set<string>();
  for (const field of fields) {
    if (!field) throw new Error(`Module event "${name}" fields must be non-empty strings`);
    if (seenFields.has(field)) {
      throw new Error(`Module event "${name}" declares duplicate field "${field}"`);
    }
    seenFields.add(field);
    if (!schemaPathExists(payloadSchema, field)) {
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
    if (!schemaPathExists(payloadSchema, path)) {
      throw new Error(
        `Module event "${name}" filterable path "${path}" is not present in the payload schema`,
      );
    }
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
