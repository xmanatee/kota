/**
 * Review gate for owner questions — keeps the bar high by rejecting
 * structurally weak or duplicative escalations before they reach the owner.
 *
 * The gate is intentionally rule-based and deterministic: agents should
 * rework the question instead of learning to evade a fuzzy reviewer, and
 * the owner should never see a question that does not meet the minimum
 * structural contract.
 */
import type { PendingOwnerQuestion } from "./owner-question-queue.js";

export type OwnerQuestionReviewInput = {
  context: string;
  question: string;
  reason: string;
  proposedAnswers?: string[];
};

export type OwnerQuestionReview =
  | { ok: true }
  | { ok: false; reason: string };

const CONTEXT_MIN = 20;
const CONTEXT_MAX = 2000;
const QUESTION_MIN = 10;
const QUESTION_MAX = 500;
const REASON_MIN = 20;
const REASON_MAX = 500;
const MAX_PROPOSED_ANSWERS = 6;
const PROPOSED_ANSWER_MAX_LEN = 300;
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEDUP_SIMILARITY_THRESHOLD = 0.85;

export function reviewOwnerQuestion(
  input: OwnerQuestionReviewInput,
  recent: readonly PendingOwnerQuestion[] = [],
): OwnerQuestionReview {
  const context = input.context?.trim() ?? "";
  const question = input.question?.trim() ?? "";
  const reason = input.reason?.trim() ?? "";

  if (context.length < CONTEXT_MIN) {
    return { ok: false, reason: `context is too thin (${context.length} chars; need at least ${CONTEXT_MIN}). Summarize the decision and the surrounding work.` };
  }
  if (context.length > CONTEXT_MAX) {
    return { ok: false, reason: `context is too long (${context.length} chars; keep under ${CONTEXT_MAX}). Tighten the summary.` };
  }

  if (question.length < QUESTION_MIN) {
    return { ok: false, reason: `question is too short (${question.length} chars; need at least ${QUESTION_MIN}). Ask a concrete, answerable question.` };
  }
  if (question.length > QUESTION_MAX) {
    return { ok: false, reason: `question is too long (${question.length} chars; keep under ${QUESTION_MAX}). Narrow it.` };
  }
  if (!question.endsWith("?")) {
    return { ok: false, reason: "question must end with a question mark. Ask a concrete, answerable question." };
  }

  if (reason.length < REASON_MIN) {
    return { ok: false, reason: `reason is too thin (${reason.length} chars; need at least ${REASON_MIN}). Explain why owner input is required instead of proceeding with best judgment.` };
  }
  if (reason.length > REASON_MAX) {
    return { ok: false, reason: `reason is too long (${reason.length} chars; keep under ${REASON_MAX}).` };
  }

  if (input.proposedAnswers) {
    if (input.proposedAnswers.length > MAX_PROPOSED_ANSWERS) {
      return { ok: false, reason: `too many proposed answers (${input.proposedAnswers.length}; keep at most ${MAX_PROPOSED_ANSWERS}). Pick the real contenders.` };
    }
    for (const answer of input.proposedAnswers) {
      const trimmed = answer.trim();
      if (trimmed.length === 0) {
        return { ok: false, reason: "proposed answers must not be empty." };
      }
      if (trimmed.length > PROPOSED_ANSWER_MAX_LEN) {
        return { ok: false, reason: `proposed answer is too long (${trimmed.length} chars; keep under ${PROPOSED_ANSWER_MAX_LEN}).` };
      }
    }
    const normalized = input.proposedAnswers.map((a) => a.trim().toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      return { ok: false, reason: "proposed answers contain duplicates." };
    }
  }

  const lowerQuestion = question.toLowerCase();
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const prior of recent) {
    if (new Date(prior.createdAt).getTime() < cutoff) continue;
    if (prior.status === "answered") continue;
    const similarity = jaccardSimilarity(lowerQuestion, prior.question.toLowerCase());
    if (similarity >= DEDUP_SIMILARITY_THRESHOLD) {
      return {
        ok: false,
        reason: `a substantially similar question [${prior.id}] is already in the queue (status=${prior.status}, similarity=${similarity.toFixed(2)}). Resolve or reference it instead of re-asking.`,
      };
    }
  }

  return { ok: true };
}

function tokenize(text: string): Set<string> {
  return new Set(text.split(/\W+/).filter((t) => t.length > 2));
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
