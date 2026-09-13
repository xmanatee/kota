import { isScopePolicyPathWithin, resolveScopePolicyPath } from "#core/daemon/scope-policy-paths.js";
import type { ToolEffect } from "./effect.js";
import type { ToolFilesystemTargets } from "./filesystem-targets.js";
import type {
  ToolCallExecutionOptions,
  ToolResultEntry,
  ValidatedToolUseBlock,
} from "./tool-runner-types.js";

/** Restrict local observation for isolated KOTA-hosted reviewers. */
export function enforceAgentReadScope(
  block: ValidatedToolUseBlock,
  options: ToolCallExecutionOptions,
  targets: ToolFilesystemTargets,
  effect: ToolEffect | undefined,
): ToolResultEntry | null {
  const scope = options.agentReadScope;
  if (scope === undefined || effect?.kind !== "read" || effect.scope !== "local-fs") {
    return null;
  }
  if (targets.kind !== "known") {
    return errorEntry(
      block,
      "Blocked by agent read scope: local filesystem reads require complete targets.",
    );
  }
  const cwd = options.cwd ?? process.cwd();
  const allowedRoots = scope
    .map((path) => resolveScopePolicyPath(path, cwd))
    .filter((path): path is string => path !== null);
  for (const targetPath of targets.paths) {
    const target = resolveScopePolicyPath(targetPath, cwd);
    if (
      target === null ||
      !allowedRoots.some((root) => isScopePolicyPathWithin(root, target))
    ) {
      return errorEntry(
        block,
        `Blocked by agent read scope: ${targetPath} is outside the declared read roots.`,
      );
    }
  }
  return null;
}

function errorEntry(
  block: ValidatedToolUseBlock,
  content: string,
): ToolResultEntry {
  return { tool_use_id: block.id, content, is_error: true };
}
