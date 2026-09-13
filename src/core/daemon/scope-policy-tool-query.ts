import { localWriteEffect, type ToolEffect } from "#core/tools/effect.js";
import type { ToolFilesystemTargets } from "#core/tools/filesystem-targets.js";
import { resolveOpaqueExecutionEffects } from "#core/tools/opaque-execution-effects.js";
import type { ValidatedToolCallInput } from "#core/tools/tool-input-validation.js";
import { decideScopePolicy } from "./scope-policy-decisions.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyDecision,
  ScopePolicyDecisionOutcome,
  ScopePolicyToolEffectQuery,
} from "./scope-policy-types.js";

export function scopePolicyToolEffectQueries(
  toolName: string,
  effect: ToolEffect,
  input: ValidatedToolCallInput,
  targets: ToolFilesystemTargets = { kind: "none" },
): readonly ScopePolicyToolEffectQuery[] {
  const effects = [...(resolveOpaqueExecutionEffects(toolName, input) ?? [effect])];
  // A local read target describes observation. Other target declarations are
  // mutation destinations independent of the primary effect (e.g. a download).
  if (targets.kind !== "none" &&
    !(effect.kind === "read" && effect.scope === "local-fs") &&
    !effects.some((candidate) =>
    candidate.scope === "local-fs" && candidate.kind !== "read")) {
    effects.push(localWriteEffect());
  }
  return effects.flatMap((resolvedEffect) => {
    const query = scopePolicyToolEffectQuery(toolName, resolvedEffect);
    if (query.effectScope === "local-fs" &&
      (query.effectKind === "write" || query.effectKind === "destructive") &&
      targets.kind === "known" && targets.paths.length > 0) {
      return targets.paths.map((targetPath) => ({ ...query, targetPath }));
    }
    return [query];
  });
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
  targets: ToolFilesystemTargets = { kind: "none" },
): ScopePolicyDecision {
  const decisions = scopePolicyToolEffectQueries(toolName, effect, input, targets)
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
): ScopePolicyToolEffectQuery {
  return {
    kind: "tool-effect",
    toolName,
    effectKind: effect.kind,
    effectScope: effect.scope,
  } as ScopePolicyToolEffectQuery;
}
