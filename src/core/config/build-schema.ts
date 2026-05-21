import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGenerator } from "ts-json-schema-generator";
import { discoverProjectModules } from "../modules/project-discovery.js";
import { getRegisteredConfigSlices } from "./config-slice.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = process.env.KOTA_SCHEMA_OUT ?? resolve(ROOT, "schema/kota-config.schema.json");

type GeneratedSchema = {
  definitions?: Record<string, unknown>;
};

function runGenerator(relativePath: string, typeName: string): GeneratedSchema {
  const schema = createGenerator({
    path: resolve(ROOT, relativePath),
    type: typeName,
    tsconfig: resolve(ROOT, "tsconfig.json"),
    skipTypeCheck: true,
  }).createSchema(typeName);
  return sortObjectKeys(schema) as GeneratedSchema;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  const record = objectRecord(value);
  if (!record) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) {
    result[key] = sortObjectKeys(child);
  }
  return result;
}

function resolveRefs(obj: unknown, defs: Record<string, unknown>): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => resolveRefs(item, defs));

  const record = obj as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    const refName = record.$ref.replace("#/definitions/", "");
    const resolved = defs[refName];
    if (!resolved) throw new Error(`Unresolved $ref: ${record.$ref}`);
    return resolveRefs(resolved, defs);
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    result[key] = resolveRefs(val, defs);
  }
  return result;
}

const baseGenerated = runGenerator("src/core/config/config.ts", "KotaConfig");

const kotaDef = baseGenerated.definitions?.KotaConfig;
if (!kotaDef) throw new Error("KotaConfig definition not found in generated schema");

const inlinedBase = resolveRefs(kotaDef, baseGenerated.definitions ?? {}) as Record<string, unknown>;
const baseProperties = objectRecord(inlinedBase.properties) ?? {};

// Discover modules to populate the global slice registry.
await discoverProjectModules();

const sliceProperties: Record<string, unknown> = {};
for (const slice of getRegisteredConfigSlices()) {
  const generated = runGenerator(
    slice.schemaSource.relativePath,
    slice.schemaSource.typeName,
  );
  const def = generated.definitions?.[slice.schemaSource.typeName];
  if (!def) {
    throw new Error(
      `Slice "${slice.key}" expected JSON Schema definition for "${slice.schemaSource.typeName}" in ${slice.schemaSource.relativePath} but none was generated`,
    );
  }
  const inlinedSlice = resolveRefs(def, generated.definitions ?? {}) as Record<string, unknown>;
  inlinedSlice.description = slice.description;
  sliceProperties[slice.key] = inlinedSlice;
}

const mergedProperties = Object.fromEntries(
  Object.entries({ ...baseProperties, ...sliceProperties }).sort(([a], [b]) =>
    a.localeCompare(b),
  ),
);

const inlined = { ...inlinedBase, properties: mergedProperties };

const modulesSchema = objectRecord(mergedProperties.modules);
if (modulesSchema) {
  const moduleProperties = objectRecord(modulesSchema.properties) ?? {};
  // Walk registered modules again — discoverProjectModules above only
  // returned the modules and triggered slice registration; we now also
  // surface their `configSchema` fragments (for `config.modules.<name>`).
  for (const mod of await discoverProjectModules()) {
    if (mod.configSchema) moduleProperties[mod.name] = mod.configSchema;
  }
  if (Object.keys(moduleProperties).length > 0) {
    modulesSchema.properties = Object.fromEntries(
      Object.entries(moduleProperties).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://kota.dev/schema/kota-config.schema.json",
  title: "KotaConfig",
  description:
    "KOTA configuration file (.kota/config.json). Project-level config overrides global (~/.kota/config.json); CLI flags override both.",
  ...inlined,
};

const output = `${JSON.stringify(schema, null, 2)}\n`;
writeFileSync(OUT, output, "utf-8");
const propCount = Object.keys(mergedProperties).length;
process.stderr.write(`schema/kota-config.schema.json generated (${propCount} top-level properties)\n`);
