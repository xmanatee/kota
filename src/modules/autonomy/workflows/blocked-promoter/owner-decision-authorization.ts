import { basename } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  type BlockedPrecondition,
  parseBlockedPrecondition,
} from "#modules/repo-tasks/blocked-precondition.js";
import type { OwnerAskCandidate } from "./promotion.js";

const UNBLOCK_ANSWER = "unblock";

export type OwnerDecisionCandidateSnapshot = {
  taskId: string;
  taskPath: string;
  slot: string;
  question: string;
  context: string | null;
  proposedAnswers: string[];
};

/**
 * Treat only the displayed literal `unblock` token as promotion authority.
 * Generic affirmative words are ambiguous because the task-authored question
 * may give them the opposite meaning.
 */
export function answerApprovesPromotion(
  answer: string,
  displayedAnswers: string[],
): boolean {
  const normalized = answer.trim().toLowerCase();
  return (
    normalized === UNBLOCK_ANSWER &&
    displayedAnswers.some(
      (displayed) => displayed.trim().toLowerCase() === UNBLOCK_ANSWER,
    )
  );
}

function candidateMatchesPrecondition(
  candidate: OwnerDecisionCandidateSnapshot,
  current: Extract<BlockedPrecondition, { kind: "owner-decision" }>,
): boolean {
  return (
    current.slot === candidate.slot &&
    current.question === candidate.question &&
    current.context === candidate.context &&
    current.proposedAnswers.length === candidate.proposedAnswers.length &&
    current.proposedAnswers.every(
      (answer, index) => answer === candidate.proposedAnswers[index],
    )
  );
}

/** Fail closed if task identity or owner-decision semantics changed during the wait. */
export function assertOwnerDecisionCandidateIsCurrent(
  raw: string,
  candidate: OwnerDecisionCandidateSnapshot,
): void {
  const { attrs } = parseFlatFrontMatter(raw);
  const parsed = parseBlockedPrecondition(raw);
  if (
    basename(candidate.taskPath, ".md") !== candidate.taskId ||
    String(attrs.status ?? "") !== "blocked" ||
    !parsed.ok ||
    parsed.precondition.kind !== "owner-decision" ||
    !candidateMatchesPrecondition(candidate, parsed.precondition)
  ) {
    throw new Error(
      `blocked-promoter: owner-decision precondition changed while awaiting an answer for ${candidate.taskId}; refusing to apply the stale outcome`,
    );
  }
}

export function displayedOwnerAnswers(candidate: OwnerAskCandidate): string[] {
  const proposed = candidate.proposedAnswers.length > 0
    ? candidate.proposedAnswers
    : ["unblock"];
  const recommended = candidate.recommendedAnswer?.trim().toLowerCase();
  const recommendedIndex = recommended
    ? proposed.findIndex((answer) => answer.trim().toLowerCase() === recommended)
    : -1;
  const reordered = recommendedIndex > 0
    ? [
        proposed[recommendedIndex]!,
        ...proposed.slice(0, recommendedIndex),
        ...proposed.slice(recommendedIndex + 1),
      ]
    : proposed;
  return reordered.some((answer) => answer.trim().toLowerCase() === "unblock")
    ? reordered
    : [...reordered, "unblock"];
}
