import { resolveAgentFilesystemWriteRoots } from "#core/agent-harness/agent-write-scope-roots.js";
import { isScopePolicyPathWithin, resolveScopePolicyPath } from "#core/daemon/scope-policy-paths.js";
import { scopePolicyToolEffectQueries } from "#core/daemon/scope-policy-tool-query.js";
import type { ScopePolicyToolEffectQuery } from "#core/daemon/scope-policy-types.js";
import { getToolEffect } from "./index.js";
import type {
  ToolCallExecutionOptions,
  ToolResultEntry,
  ValidatedToolUseBlock,
} from "./tool-runner-types.js";

export function enforceAgentWriteScope(
  block: ValidatedToolUseBlock,
  options: ToolCallExecutionOptions,
): ToolResultEntry | null {
  const scope = options.agentWriteScope;
  if (scope === undefined || (scope !== "deny-all" && scope.length === 0)) {
    return null;
  }

  const effect = getToolEffect(block.name, block.input);
  if (!effect) {
    return errorEntry(
      block,
      `Blocked by agent write scope: ${block.name} has no declared tool effect.`,
    );
  }
  const writeQueries = scopePolicyToolEffectQueries(block.name, effect, block.input)
    .filter(isLocalWriteQuery);
  if (writeQueries.length === 0) return null;
  const cwd = options.cwd ?? process.cwd();
  const allowedRoots = resolveAgentFilesystemWriteRoots(
    cwd,
    scope,
    options.agentOutputDir,
  ) ?? [];
  if (allowedRoots.length === 0) {
    return errorEntry(block, "Blocked by agent write scope: local filesystem writes are denied.");
  }
  for (const query of writeQueries) {
    if (query.targetPath === undefined) {
      return errorEntry(
        block,
        "Blocked by agent write scope: write-capable execution does not expose a complete filesystem target.",
      );
    }
    const target = resolveScopePolicyPath(query.targetPath, cwd);
    if (
      target === null ||
      !allowedRoots.some((root) => isScopePolicyPathWithin(root, target))
    ) {
      return errorEntry(
        block,
        `Blocked by agent write scope: ${query.targetPath} is outside the declared write roots.`,
      );
    }
  }
  return null;
}

export function isAgentOutputOnlyWrite(
  block: ValidatedToolUseBlock,
  options: ToolCallExecutionOptions,
): boolean {
  if (options.agentOutputDir === undefined) return false;
  const effect = getToolEffect(block.name, block.input);
  if (!effect) return false;
  const queries = scopePolicyToolEffectQueries(block.name, effect, block.input);
  if (queries.length === 0) return false;

  const cwd = options.cwd ?? process.cwd();
  const outputRoots = resolveAgentFilesystemWriteRoots(
    cwd,
    "deny-all",
    options.agentOutputDir,
  ) ?? [];
  return outputRoots.length === 1 && queries.every((query) => {
    if (!isLocalWriteQuery(query) || query.targetPath === undefined) return false;
    const target = resolveScopePolicyPath(query.targetPath, cwd);
    return target !== null && isScopePolicyPathWithin(outputRoots[0], target);
  });
}

type LocalWriteQuery = Extract<
  ScopePolicyToolEffectQuery,
  { effectKind: "write" | "destructive"; effectScope: "local-fs" }
>;

function isLocalWriteQuery(
  query: ScopePolicyToolEffectQuery,
): query is LocalWriteQuery {
  return query.effectScope === "local-fs" &&
    (query.effectKind === "write" || query.effectKind === "destructive");
}

function errorEntry(
  block: ValidatedToolUseBlock,
  content: string,
): ToolResultEntry {
  return { tool_use_id: block.id, content, is_error: true };
}
