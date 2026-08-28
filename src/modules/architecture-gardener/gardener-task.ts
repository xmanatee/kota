import type { GeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal-types.js";
import {
  type StagedGeneratedWorkProposalResult,
  stageGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-transaction.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import type { ParetoEvaluation, SimplificationHypothesis } from "./types.js";

/** Slugify target scope for stable proposal keys. */
export function slugifyScope(scope: string): string {
  return scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Render a standardized task markdown body for an accepted SimplificationHypothesis. */
export function renderGardenerTaskBody(args: {
  hypothesis: SimplificationHypothesis;
  pareto: ParetoEvaluation;
}): string {
  const { hypothesis } = args;
  const dim = hypothesis.structuralImprovement.dimension;

  const candidateActionList = hypothesis.candidateActions
    .map(
      (action) =>
        `- **${action.type}** on \`${action.target}\`${
          action.details ? `: ${action.details}` : ""
        }`,
    )
    .join("\n");

  const problem = `${hypothesis.problem}\n\nEvidence fingerprints: ${hypothesis.evidenceFingerprints.join(", ")}`;

  const desiredOutcome = [
    `Implement the "${dim}" architectural improvement for \`${hypothesis.targetScope}\`: ${hypothesis.structuralImprovement.description}.`,
    "",
    "Planned candidate actions:",
    candidateActionList || "- Implement targeted structural simplification.",
    "",
    `**Behavior Preservation Claim:** ${hypothesis.behaviorPreservationClaim}`,
    "",
    "Ensure the retired or obsolete path is completely removed or bounded without leaving permanent dual ownership.",
  ].join("\n");

  const constraints = [
    "- Preserve existing public interfaces and behaviors unless explicitly part of the simplification.",
    "- Do not add compatibility shims, aliases, or dual implementations.",
    "- All existing tests must pass or be simplified without reducing coverage of public behavior.",
  ].join("\n");

  const howWeWillKnow = [
    `- The named structural improvement for \`${hypothesis.targetScope}\` is verifiable in code and AST inspection.`,
    "- Architectural fitness functions report zero forbidden dependencies, zero undeclared imports, zero module cycles, and zero duplicate canonical ownership.",
    "- All relevant unit and integration test suites pass cleanly.",
  ].join("\n");

  return renderRepoTaskIntent({
    problem,
    desiredOutcome,
    constraints,
    howWeWillKnow,
  });
}

/**
 * Stage an implementation task for an accepted hypothesis through the shared generated-work transaction.
 * Creates at most one task per hypothesis/run.
 */
export function stageGardenerTask(args: {
  workspaceRoot: string;
  runId: string;
  hypothesis: SimplificationHypothesis;
  pareto: ParetoEvaluation;
}): StagedGeneratedWorkProposalResult {
  const scopeSlug = slugifyScope(args.hypothesis.targetScope);
  const dim = args.hypothesis.structuralImprovement.dimension;
  const proposalKey = `architecture-gardener:${scopeSlug}:${dim}`;

  const title = `Simplify architecture: ${args.hypothesis.structuralImprovement.description}`;
  const body = renderGardenerTaskBody({
    hypothesis: args.hypothesis,
    pareto: args.pareto,
  });

  const proposal: GeneratedWorkProposal = {
    kind: "task",
    proposalKey,
    title,
    priority: "p1",
    body,
    provenance: {
      source: "architecture-gardener",
      runId: args.runId,
      evidenceRefs: [...args.hypothesis.evidenceFingerprints],
    },
  };

  return stageGeneratedWorkProposal({
    workspaceRoot: args.workspaceRoot,
    proposal,
  });
}
