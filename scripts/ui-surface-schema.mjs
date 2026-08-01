import { resolve } from "node:path";
import { createGenerator } from "ts-json-schema-generator";

export const UI_SURFACE_SOURCE = "src/core/daemon/ui-surface.ts";
export const UI_SURFACE_ROOT_TYPE = "UiSurfaceBundle";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sortSchema(value) {
  if (Array.isArray(value)) return value.map(sortSchema);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortSchema(child)]),
  );
}

export function buildUiSurfaceSchema(root) {
  const schema = createGenerator({
    path: resolve(root, UI_SURFACE_SOURCE),
    type: UI_SURFACE_ROOT_TYPE,
    tsconfig: resolve(root, "tsconfig.json"),
    skipTypeCheck: true,
  }).createSchema(UI_SURFACE_ROOT_TYPE);

  return sortSchema(schema);
}
