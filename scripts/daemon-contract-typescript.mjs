import {
  DAEMON_CAPABILITY_GRAPH,
  DAEMON_CONTRACT_VERSION,
  DAEMON_EVENT_GRAPH,
  DAEMON_ROUTE_GRAPH,
  DAEMON_TYPE_ALIASES,
  DAEMON_WIRE_SOURCE,
} from "./daemon-contract-graph.mjs";

const EXTRA_ALIASES = {
  RecallAnswerHitResult: 'RecallAnswerHit["result"]',
};

function referenceName(ref) {
  return ref.replace("#/definitions/", "");
}

function literal(value) {
  return JSON.stringify(value);
}

function propertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function typeExpression(schema, indent = 0) {
  if (schema.$ref !== undefined) return referenceName(schema.$ref);
  if (schema.const !== undefined) return literal(schema.const);
  if (schema.enum !== undefined) return schema.enum.map(literal).join(" | ");
  if (schema.anyOf !== undefined) {
    return schema.anyOf.map((item) => typeExpression(item, indent)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => typeExpression({ ...schema, type }, indent)).join(" | ");
  }
  switch (schema.type) {
    case "null": return "null";
    case "string": return "string";
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "array": return `Array<${typeExpression(schema.items ?? {}, indent)}>`;
    case "object": return objectExpression(schema, indent);
    case undefined: return "unknown";
    default: throw new Error(`Unsupported TypeScript schema type: ${schema.type}`);
  }
}

function objectExpression(schema, indent) {
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {});
  const pad = "  ".repeat(indent + 1);
  const closePad = "  ".repeat(indent);
  const lines = properties.map(([name, child]) =>
    `${pad}readonly ${propertyName(name)}${required.has(name) ? "" : "?"}: ${typeExpression(child, indent + 1)};`
  );
  if (typeof schema.additionalProperties === "object") {
    lines.push(`${pad}readonly [key: string]: ${typeExpression(schema.additionalProperties, indent + 1)};`);
  } else if (schema.additionalProperties === true && properties.length === 0) {
    lines.push(`${pad}readonly [key: string]: unknown;`);
  }
  return lines.length === 0 ? "Record<string, never>" : `{\n${lines.join("\n")}\n${closePad}}`;
}

function emitTypes(schema) {
  const definitions = Object.entries(schema.definitions ?? {})
    .map(([name, definition]) => `export type ${name} = ${typeExpression(definition)};`);
  const aliases = Object.entries({ ...DAEMON_TYPE_ALIASES, ...EXTRA_ALIASES })
    .map(([name, target]) => `export type ${name} = ${target};`);
  return [...definitions, ...aliases].join("\n\n");
}

function emitRuntime(schema) {
  const root = schema.definitions?.DaemonWireContract;
  if (root?.properties === undefined) throw new Error("DaemonWireContract schema has no properties");
  const parsers = DAEMON_ROUTE_GRAPH.map(({ id, parser, type }) => {
    if (root.properties[id] === undefined) throw new Error(`Route ${id} has no DaemonWireContract property`);
    return [
      `export function ${parser}(raw: unknown): ${type} {`,
      `  validateSchema(raw, DAEMON_CONTRACT_SCHEMA.definitions!.DaemonWireContract!.properties!.${id}!, ${JSON.stringify(id)});`,
      `  return raw as ${type};`,
      `}`,
    ].join("\n");
  });
  return `
type SchemaScalar = string | number | boolean | null;
type GeneratedSchema = {
  readonly $ref?: string;
  readonly definitions?: Readonly<Record<string, GeneratedSchema>>;
  readonly anyOf?: readonly GeneratedSchema[];
  readonly type?: string | readonly string[];
  readonly enum?: readonly SchemaScalar[];
  readonly const?: SchemaScalar;
  readonly properties?: Readonly<Record<string, GeneratedSchema>>;
  readonly required?: readonly string[];
  readonly items?: GeneratedSchema;
  readonly additionalProperties?: boolean | GeneratedSchema;
};

const DAEMON_CONTRACT_SCHEMA: GeneratedSchema = JSON.parse(${JSON.stringify(JSON.stringify(schema))});

export class ContractDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDecodeError";
  }
}

function fail(message: string): never { throw new ContractDecodeError(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function displayValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
function resolveSchema(schema: GeneratedSchema): GeneratedSchema {
  if (schema.$ref === undefined) return schema;
  const prefix = "#/definitions/";
  if (!schema.$ref.startsWith(prefix)) fail(\`unsupported schema reference \${schema.$ref}\`);
  const resolved = DAEMON_CONTRACT_SCHEMA.definitions?.[schema.$ref.slice(prefix.length)];
  if (resolved === undefined) fail(\`unresolved schema reference \${schema.$ref}\`);
  return resolveSchema(resolved);
}
function allowedValues(schema: GeneratedSchema): readonly SchemaScalar[] | undefined {
  if (schema.const !== undefined) return [schema.const];
  return schema.enum;
}
function findDiscriminator(schemas: readonly GeneratedSchema[]): string | undefined {
  const candidates = schemas.map(resolveSchema);
  const first = candidates[0]?.properties;
  if (first === undefined) return undefined;
  return Object.keys(first).find((key) => candidates.every((candidate) => {
    const property = candidate.properties?.[key];
    return property !== undefined && allowedValues(resolveSchema(property)) !== undefined;
  }));
}
function validateUnion(value: unknown, schemas: readonly GeneratedSchema[], path: string): void {
  const discriminator = findDiscriminator(schemas);
  if (discriminator !== undefined && isRecord(value)) {
    const actual = value[discriminator];
    const matching = schemas.filter((candidate) => {
      const property = resolveSchema(candidate).properties?.[discriminator];
      return property !== undefined && allowedValues(resolveSchema(property))?.some((item) => Object.is(item, actual));
    });
    if (matching.length === 0) fail(\`unknown \${path}.\${discriminator}: \${displayValue(actual)}\`);
    let firstMatchingError: ContractDecodeError | undefined;
    for (const candidate of matching) {
      try { validateSchema(value, candidate, path); return; }
      catch (error) {
        if (!(error instanceof ContractDecodeError)) throw error;
        firstMatchingError ??= error;
      }
    }
    throw firstMatchingError ?? new ContractDecodeError(\`value at \${path} does not match the generated contract\`);
  }
  let firstError: ContractDecodeError | undefined;
  for (const candidate of schemas) {
    try { validateSchema(value, candidate, path); return; }
    catch (error) {
      if (!(error instanceof ContractDecodeError)) throw error;
      firstError ??= error;
    }
  }
  throw firstError ?? new ContractDecodeError(\`value at \${path} does not match the generated contract\`);
}
function validateObject(value: unknown, schema: GeneratedSchema, path: string): void {
  if (!isRecord(value)) fail(\`expected object at \${path}\`);
  for (const key of schema.required ?? []) {
    if (value[key] === undefined) fail(\`expected required field at \${path}.\${key}\`);
  }
  const properties = schema.properties ?? {};
  for (const [key, child] of Object.entries(properties)) {
    if (value[key] !== undefined) validateSchema(value[key], child, \`\${path}.\${key}\`);
  }
  for (const key of Object.keys(value)) {
    if (properties[key] !== undefined) continue;
    if (schema.additionalProperties === false) fail(\`unexpected field at \${path}.\${key}\`);
    if (isRecord(schema.additionalProperties)) validateSchema(value[key], schema.additionalProperties, \`\${path}.\${key}\`);
  }
}
function validateSchema(value: unknown, raw: GeneratedSchema, path: string): void {
  const schema = resolveSchema(raw);
  if (schema.anyOf !== undefined) { validateUnion(value, schema.anyOf, path); return; }
  if (Array.isArray(schema.type)) {
    validateUnion(value, schema.type.map((type) => ({ ...schema, type })), path);
    return;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) fail(\`expected \${displayValue(schema.const)} at \${path}\`);
  if (schema.enum !== undefined && !schema.enum.some((item) => Object.is(item, value))) fail(\`unknown \${path}: \${displayValue(value)}\`);
  switch (schema.type) {
    case undefined: return;
    case "null": if (value !== null) fail(\`expected null at \${path}\`); return;
    case "string": if (typeof value !== "string") fail(\`expected string at \${path}\`); return;
    case "number": if (typeof value !== "number" || !Number.isFinite(value)) fail(\`expected number at \${path}\`); return;
    case "integer": if (typeof value !== "number" || !Number.isInteger(value)) fail(\`expected integer at \${path}\`); return;
    case "boolean": if (typeof value !== "boolean") fail(\`expected boolean at \${path}\`); return;
    case "array":
      if (!Array.isArray(value)) fail(\`expected array at \${path}\`);
      if (schema.items !== undefined) value.forEach((item, index) => validateSchema(item, schema.items!, \`\${path}[\${index}]\`));
      return;
    case "object": validateObject(value, schema, path); return;
    default: fail(\`unsupported schema type \${schema.type} at \${path}\`);
  }
}

${parsers.join("\n\n")}
`;
}

function emitTransportGraph() {
  const routes = Object.fromEntries(DAEMON_ROUTE_GRAPH.map(({ id, method, path }) => [id, { method, path }]));
  return [
    `export const DAEMON_CONTRACT_VERSION = ${JSON.stringify(DAEMON_CONTRACT_VERSION)} as const;`,
    `export const DAEMON_ROUTES = ${JSON.stringify(routes, null, 2)} as const;`,
    `export const DAEMON_EVENT_TYPES = ${JSON.stringify(DAEMON_EVENT_GRAPH, null, 2)} as const;`,
    `export type DaemonEventType = (typeof DAEMON_EVENT_TYPES)[number];`,
    `export const DAEMON_CAPABILITY_IDS = ${JSON.stringify(DAEMON_CAPABILITY_GRAPH, null, 2)} as const;`,
  ].join("\n\n");
}

export function generateDaemonTypeScriptBinding(schema) {
  return [
    `// Generated from ${DAEMON_WIRE_SOURCE} and scripts/daemon-contract-graph.mjs.`,
    "// Do not edit this file directly. Run `pnpm build:client-bindings`.",
    "",
    emitTypes(schema),
    "",
    emitTransportGraph(),
    emitRuntime(schema),
  ].join("\n");
}
