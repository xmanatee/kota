import type {
  OwnerDecisionClientProjection,
  OwnerDecisionRecord,
  OwnerDecisionSelectedValue,
  OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import { projectOwnerDecisionForClient } from "#core/daemon/owner-decision-store.js";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";

const RESOLVED_SOURCE_PREFIX = "owner-decision:";

export function serializeOwnerDecisionSelection(value: OwnerDecisionSelectedValue): string {
  if (value.kind === "single-choice") return value.optionId;
  if (value.kind === "multi-choice") return value.optionIds.join(", ");
  if (value.kind === "free-text") return value.text;
  return JSON.stringify(value.fields);
}

function resolveLinkedQuestionAnswer(
  queue: OwnerQuestionQueue,
  decision: OwnerDecisionRecord,
  selectedValue: OwnerDecisionSelectedValue,
  source: string,
): void {
  if (!decision.ownerQuestionId) return;
  const question = queue.get(decision.ownerQuestionId);
  if (!question || question.status !== "pending") return;
  queue.answer(
    decision.ownerQuestionId,
    serializeOwnerDecisionSelection(selectedValue),
    `${RESOLVED_SOURCE_PREFIX}${source}`,
  );
}

function resolveLinkedQuestionCancel(
  queue: OwnerQuestionQueue,
  decision: OwnerDecisionRecord,
  reason: string,
  source: string,
): void {
  if (!decision.ownerQuestionId) return;
  const question = queue.get(decision.ownerQuestionId);
  if (!question || question.status !== "pending") return;
  queue.dismiss(decision.ownerQuestionId, reason, `${RESOLVED_SOURCE_PREFIX}${source}`);
}

export function listOwnerDecisionsLocal(
  store: OwnerDecisionStore,
  status?: OwnerDecisionRecord["status"] | "all",
): { decisions: OwnerDecisionClientProjection[] } {
  if (status === undefined) return { decisions: store.list("pending").map(projectOwnerDecisionForClient) };
  if (status === "all") return { decisions: store.list().map(projectOwnerDecisionForClient) };
  return { decisions: store.list(status).map(projectOwnerDecisionForClient) };
}

export function showOwnerDecisionLocal(
  store: OwnerDecisionStore,
  id: string,
): OwnerDecisionClientProjection | null {
  const decision = store.get(id);
  return decision ? projectOwnerDecisionForClient(decision) : null;
}

export function answerOwnerDecisionLocal(
  store: OwnerDecisionStore,
  questionQueue: OwnerQuestionQueue,
  id: string,
  selectedValue: OwnerDecisionSelectedValue,
  source: string,
): OwnerDecisionClientProjection | null {
  const decision = store.answer(id, selectedValue, source);
  if (!decision) return null;
  if (!decision.selectedValue) throw new Error(`owner decision ${id} was answered without a selected value`);
  resolveLinkedQuestionAnswer(questionQueue, decision, decision.selectedValue, source);
  return projectOwnerDecisionForClient(decision);
}

export function cancelOwnerDecisionLocal(
  store: OwnerDecisionStore,
  questionQueue: OwnerQuestionQueue,
  id: string,
  reason: string,
  source: string,
): OwnerDecisionClientProjection | null {
  const decision = store.cancel(id, reason, source);
  if (!decision) return null;
  resolveLinkedQuestionCancel(questionQueue, decision, reason, source);
  return projectOwnerDecisionForClient(decision);
}
