import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadManifest, saveManifest } from "./persistence.js";
import type { ModuleManifest } from "./types.js";
import { validateManifest } from "./validation.js";

/** One-way conversion before trusted module discovery; never a second runtime loader. */
export function migrateSavedTools(scopeRoot: string): void {
  const directory = join(scopeRoot, ".kota", "tools");
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const source = join(directory, entry.name);
    const raw: unknown = JSON.parse(readFileSync(source, "utf8"));
    const name = entry.name.slice(0, -5);
    const candidate = { name, tools: [raw] };
    const errors = validateManifest(candidate);
    if (errors.length || (raw as { name: string }).name !== name) {
      throw new Error(`Cannot convert saved tool ${source}: ${errors.map((e) => e.message).join("; ") || "filename and tool name differ"}`);
    }
    const manifest = candidate as ModuleManifest;
    const target = join(scopeRoot, ".kota", "modules", name);
    if (existsSync(target)) {
      // An identical target means a previous conversion committed before source removal.
      if (!isDeepStrictEqual(loadManifest(name, scopeRoot), manifest)) {
        throw new Error(`Cannot convert ${source}: module ${name} already exists`);
      }
    } else {
      saveManifest(manifest, scopeRoot);
    }
    unlinkSync(source);
  }
}
