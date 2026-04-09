import type { KotaExtension } from "./extension-types.js";

/** Topological sort by dependencies. Modules with unresolvable deps are appended at the end. */
export function topoSort(modules: KotaExtension[]): KotaExtension[] {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const result: KotaExtension[] = [];

  function visit(mod: KotaExtension): void {
    if (visited.has(mod.name)) return;
    visited.add(mod.name);
    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        const depMod = byName.get(dep);
        if (depMod) visit(depMod);
      }
    }
    result.push(mod);
  }

  for (const mod of modules) visit(mod);
  return result;
}
