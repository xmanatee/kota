import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { OwnerInterventionOutcomeBucket } from "./owner-intervention-types.js";

const MAX_CLASSIFIED_ANSWER_CHARS = 500;

export function classifyOwnerInterventionOutcome(
  question: PendingOwnerQuestion,
): OwnerInterventionOutcomeBucket {
  if (question.status !== "answered") return "not-answered";
  const answer = question.answer ?? "";
  if (matchesProposedAnswer(answer, question.proposedAnswers ?? [])) {
    return "proposed-option";
  }
  const normalized = normalizeAnswerForRules(answer);
  if (normalized.length === 0 || answer.length > MAX_CLASSIFIED_ANSWER_CHARS) {
    return "ambiguous-answer";
  }
  if (isProviderNoiseDismissal(normalized)) return "provider-noise-dismissal";
  if (isSetupAction(normalized)) return "setup-action";
  if (isFreeformCorrection(normalized)) return "freeform-correction";
  return "ambiguous-answer";
}

function matchesProposedAnswer(
  answer: string,
  proposedAnswers: readonly string[],
): boolean {
  if (proposedAnswers.length === 0) return false;
  const normalizedAnswer = normalizeAnswerForMatching(answer);
  if (normalizedAnswer.length === 0) return false;
  return proposedAnswers.some(
    (proposed) => normalizeAnswerForMatching(proposed) === normalizedAnswer,
  );
}

function normalizeAnswerForMatching(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`.,:;!?()[\]{}-]+|[\s"'`.,:;!?()[\]{}-]+$/g, "");
}

function normalizeAnswerForRules(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isProviderNoiseDismissal(answer: string): boolean {
  return /\b(provider|model|api|sdk|network|rate limit|quota|timeout)\b/.test(answer) &&
    /\b(noise|flak(?:e|y)|transient|ignore|dismiss|false alarm|outage)\b/.test(answer);
}

function isSetupAction(answer: string): boolean {
  return /\b(set ?up|configure|install|login|log in|authenticate|credential|secret|token|api key|storage state|playwright)\b/.test(answer);
}

function isFreeformCorrection(answer: string): boolean {
  return /\b(instead|rather than|do not|don't|stop|switch|redirect|rescope|drop|move|use|choose|prefer|block|decompose|retry|fix)\b/.test(answer);
}
