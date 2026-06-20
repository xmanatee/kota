import type {
  AutomationBlocker,
  AutomationExplainResult,
} from "../graph/index.js";
import type {
  WorkflowSimulationEffectPreview,
  WorkflowSimulationOutcome,
} from "./types.js";

export const OUTCOMES: readonly WorkflowSimulationOutcome[] = [
  "would-ignore",
  "would-batch",
  "would-queue",
  "would-block",
  "would-ask-owner",
  "would-dlq",
  "would-perform-effect",
  "would-noop",
  "unknown",
];

function ownerConfirmationPresent(blockers: readonly AutomationBlocker[]): boolean {
  return blockers.some((blocker) => blocker.kind === "owner-confirmation");
}

function blockingPresent(blockers: readonly AutomationBlocker[]): boolean {
  return blockers.some((blocker) =>
    blocker.kind === "setup" ||
    blocker.kind === "owner-confirmation" ||
    blocker.kind === "approval" ||
    blocker.kind === "idempotency" ||
    blocker.kind === "schema" ||
    blocker.kind === "source"
  );
}

export function effectPreviews(
  explain: AutomationExplainResult,
): WorkflowSimulationEffectPreview[] {
  return explain.matches.flatMap((match) =>
    match.effects.map((effect) => {
      const blocked = effect.simulation.blocked;
      return {
        ...effect,
        workflow: match.workflow,
        wouldPerform: !blocked,
        blocked,
        ...(effect.simulation.reason ? { reason: effect.simulation.reason } : {}),
      };
    })
  );
}

export function blockers(explain: AutomationExplainResult): AutomationBlocker[] {
  return explain.matches.flatMap((match) => match.blockers);
}

export function outcomeForExplain(
  explain: AutomationExplainResult,
  effects: readonly WorkflowSimulationEffectPreview[],
  blockersForMatches: readonly AutomationBlocker[],
): WorkflowSimulationOutcome {
  switch (explain.outcome) {
    case "ignored":
      return "would-ignore";
    case "batched":
      return "would-batch";
    case "dead-letter":
      return "would-dlq";
    case "no-op":
      return "would-noop";
    case "blocked":
      return ownerConfirmationPresent(blockersForMatches)
        ? "would-ask-owner"
        : "would-block";
    case "queued":
      if (ownerConfirmationPresent(blockersForMatches)) return "would-ask-owner";
      if (blockingPresent(blockersForMatches)) return "would-block";
      if (effects.some((effect) => effect.wouldPerform)) return "would-perform-effect";
      return "would-queue";
    case "unknown":
      return "unknown";
  }
}
