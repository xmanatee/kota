import type {
  ScopeImprovementCandidate,
  ScopeImprovementEvidencePacket,
  ScopeImprovementInputs,
  ScopeImprovementRecommendation,
} from "./scope-improvement-types.js";

export function recommendScopeImprovements(args: {
  inputs: ScopeImprovementInputs;
  evidence: ScopeImprovementEvidencePacket;
}): ScopeImprovementRecommendation[] {
  return args.evidence.candidates.map((candidate) => {
    if (hasSeenSignature(args.inputs, candidate.signature)) {
      return {
        kind: "skipped",
        signature: candidate.signature,
        reason: "matching recommendation was already recorded for this scope",
        evidenceIds: candidate.evidenceIds,
      };
    }
    if (candidate.preferredAction === "safe-edit") return safeEdit(candidate);
    if (candidate.preferredAction === "owner-question") {
      return ownerQuestion(args.inputs, candidate);
    }
    return {
      kind: "create-task",
      signature: candidate.signature,
      title: candidate.title,
      summary: candidate.summary,
      evidenceIds: candidate.evidenceIds,
    };
  });
}

function hasSeenSignature(
  inputs: ScopeImprovementInputs,
  signature: string,
): boolean {
  return inputs.state.recentSignatures.some((entry) => entry.signature === signature);
}

function safeEdit(
  candidate: ScopeImprovementCandidate,
): ScopeImprovementRecommendation {
  return {
    kind: "safe-edit",
    signature: candidate.signature,
    path: "AGENTS.md",
    title: candidate.title,
    summary: candidate.summary,
    evidenceIds: candidate.evidenceIds,
  };
}

function ownerQuestion(
  inputs: ScopeImprovementInputs,
  candidate: ScopeImprovementCandidate,
): ScopeImprovementRecommendation {
  return {
    kind: "owner-question",
    signature: candidate.signature,
    question:
      `What durable guidance should KOTA follow before improving ${inputs.scope.displayName}?`,
    reason: candidate.summary,
    evidenceIds: candidate.evidenceIds,
    proposedAnswers: [
      "Create a minimal AGENTS.md scaffold.",
      "Wait until the owner writes scope guidance.",
    ],
  };
}
