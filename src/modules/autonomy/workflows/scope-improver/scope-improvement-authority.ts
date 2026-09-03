import { join } from "node:path";
import type {
  ScopeImprovementAuthorityProjection,
} from "#core/daemon/scope-improvement-authority-provider.js";
import {
  decideScopePolicy,
  type ResolvedScopePolicy,
  type ScopePolicyDecision,
} from "#core/daemon/scope-policy.js";
import { readScopeImprovementConfigFromStateDir } from "./scope-improvement-state.js";

export function resolveScopeImprovementAuthority(input: {
  scopeRoot: string;
  stateDir: string;
  policy: ResolvedScopePolicy;
}): ScopeImprovementAuthorityProjection {
  const config = readScopeImprovementConfigFromStateDir(
    input.stateDir,
    input.policy,
  );
  const taskProposalDecision = decideScopePolicy(input.policy, {
    kind: "tool-effect",
    toolName: "scope-improvement-actions",
    effectKind: "write",
    effectScope: "local-fs",
    targetPath: join(input.scopeRoot, "data", "tasks"),
  });
  const builderDecision = decideBuilderWriteAuthority(input.policy, input.scopeRoot);
  if (
    taskProposalDecision.outcome === "ignore" ||
    builderDecision.outcome === "ignore"
  ) {
    throw new Error("local write authority cannot resolve to ignore");
  }
  const posture =
    config.posture === "observe" || taskProposalDecision.outcome !== "allow"
      ? "observe"
      : config.posture === "build" && builderDecision.outcome !== "allow"
        ? "propose"
        : config.posture;
  return {
    enabled: config.enabled,
    configuredPosture: config.posture,
    posture,
    review: !config.enabled
      ? "disabled"
      : posture === "observe"
        ? "owner-questions"
        : "task-proposals",
    builder: config.enabled && posture === "build" ? "enabled" : "disabled",
    taskProposalDecision: {
      outcome: taskProposalDecision.outcome,
      reason: taskProposalDecision.reason,
    },
    builderDecision: {
      outcome: builderDecision.outcome,
      reason: builderDecision.reason,
    },
  };
}

function decideBuilderWriteAuthority(
  policy: ResolvedScopePolicy,
  scopeRoot: string,
): ScopePolicyDecision {
  const targets = policy.writes.mode === "paths" && policy.writes.paths.length > 0
    ? policy.writes.paths
    : [scopeRoot];
  const decisions = targets.map((targetPath) =>
    decideScopePolicy(policy, {
      kind: "tool-effect",
      toolName: "builder",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath,
    })
  );
  return decisions.find((decision) => decision.outcome === "allow") ??
    decisions.find((decision) => decision.outcome === "confirm") ??
    decisions[0]!;
}
