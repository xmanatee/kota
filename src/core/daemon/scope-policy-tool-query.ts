import type { ToolEffect } from "#core/tools/effect.js";
import { resolveOpaqueExecutionEffects } from "#core/tools/opaque-execution-effects.js";
import type { ValidatedToolCallInput } from "#core/tools/tool-input-validation.js";
import { decideScopePolicy } from "./scope-policy-decisions.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyDecision,
  ScopePolicyDecisionOutcome,
  ScopePolicyToolEffectQuery,
} from "./scope-policy-types.js";

const PATH_FIELDS = ["path", "filePath", "targetPath", "directory", "scopeRoot"] as const;

const OPAQUE_LOCAL_EXECUTION_TOOLS = new Set([
  "Bash",
  "Task",
  "code_exec",
  "process",
  "shell",
]);

export function scopePolicyToolEffectQueries(
  toolName: string,
  effect: ToolEffect,
  input: ValidatedToolCallInput,
): readonly ScopePolicyToolEffectQuery[] {
  const effects = resolveOpaqueExecutionEffects(toolName, input) ?? [effect];
  return effects.map((resolvedEffect) =>
    scopePolicyToolEffectQuery(toolName, resolvedEffect, input)
  );
}

const OUTCOME_RANK: Record<ScopePolicyDecisionOutcome, number> = {
  allow: 0,
  confirm: 1,
  deny: 2,
  ignore: 2,
};

export function decideScopePolicyToolCall(
  policy: ResolvedScopePolicy,
  toolName: string,
  effect: ToolEffect,
  input: ValidatedToolCallInput,
): ScopePolicyDecision {
  const decisions = scopePolicyToolEffectQueries(toolName, effect, input)
    .map((query) => decideScopePolicy(policy, query));
  const [first, ...rest] = decisions;
  if (!first) throw new Error(`No scope-policy effects resolved for ${toolName}`);
  return rest.reduce(
    (selected, candidate) =>
      OUTCOME_RANK[candidate.outcome] >= OUTCOME_RANK[selected.outcome]
        ? candidate
        : selected,
    first,
  );
}

function scopePolicyToolEffectQuery(
  toolName: string,
  effect: ToolEffect,
  input: ValidatedToolCallInput,
): ScopePolicyToolEffectQuery {
  if (
    effect.scope === "local-fs" &&
    (effect.kind === "write" || effect.kind === "destructive")
  ) {
    const targetPath = OPAQUE_LOCAL_EXECUTION_TOOLS.has(toolName)
      ? undefined
      : inputPath(input);
    return {
      kind: "tool-effect",
      toolName,
      effectKind: effect.kind,
      effectScope: "local-fs",
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  }
  return {
    kind: "tool-effect",
    toolName,
    effectKind: effect.kind,
    effectScope: effect.scope,
  } as ScopePolicyToolEffectQuery;
}

function inputPath(input: ValidatedToolCallInput): string | undefined {
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
