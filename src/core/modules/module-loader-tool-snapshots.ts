import type { ToolDef } from "./module-types.js";

export function moduleToolSnapshots(tools: readonly ToolDef[]) {
  return tools.map((def) => ({
    name: def.tool.name,
    description: def.tool.description,
    effect: def.effect,
  }));
}
