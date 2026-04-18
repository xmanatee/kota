import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { discoverProjectModules } from "../modules/project-discovery.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = process.env.KOTA_SCHEMA_OUT ?? resolve(ROOT, "schema/kota-config.schema.json");

const raw = execSync(
  "pnpm exec ts-json-schema-generator --path src/core/config/config.ts --type KotaConfig --tsconfig tsconfig.json",
  { cwd: ROOT, encoding: "utf-8" },
);

const generated = JSON.parse(raw);

const kotaDef = generated.definitions.KotaConfig;
if (!kotaDef) throw new Error("KotaConfig definition not found in generated schema");

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

const inlined = resolveRefs(kotaDef, generated.definitions) as Record<string, unknown>;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const projectModules = await discoverProjectModules();
const properties = objectRecord(inlined.properties);
const modulesSchema = properties ? objectRecord(properties.modules) : null;
if (modulesSchema) {
  const moduleProperties = objectRecord(modulesSchema.properties) ?? {};
  for (const mod of projectModules) {
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
const propCount = Object.keys((schema as Record<string, unknown>).properties as object).length;
process.stderr.write(`schema/kota-config.schema.json generated (${propCount} top-level properties)\n`);
