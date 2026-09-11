import type { ToolFilesystemTargetResolver } from "#core/tools/filesystem-targets.js";
import { resolveContainedPath } from "#core/tools/path-containment.js";
import type { ToolRunnerContext } from "#core/tools/tool-registry.js";

export function resolveSavePath(input: Record<string, unknown>, context?: ToolRunnerContext) {
  const saveTo = typeof input.save_to === "string" && input.save_to.length > 0 ? input.save_to : undefined;
  const root = context?.cwd ?? process.cwd();
  return saveTo ? resolveContainedPath(saveTo, root, root) : undefined;
}

export const resolveSaveTargets: ToolFilesystemTargetResolver = (input, context) => {
  const target = resolveSavePath(input, context);
  if (!target) return { kind: "none" };
  return target.ok ? { kind: "known", paths: [target.path] } : { kind: "unknown" };
};
