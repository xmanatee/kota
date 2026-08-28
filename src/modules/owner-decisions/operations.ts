import type {
  OwnerDecisionClientProjection,
  OwnerDecisionRecord,
  OwnerDecisionSelectedValue,
  OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import { projectOwnerDecisionForClient } from "#core/daemon/owner-decision-store.js";

export function serializeOwnerDecisionSelection(value: OwnerDecisionSelectedValue): string {
  if (value.kind === "single-choice") return value.optionId;
  if (value.kind === "multi-choice") return value.optionIds.join(", ");
  if (value.kind === "free-text") return value.text;
  return JSON.stringify(value.fields);
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
  id: string,
  selectedValue: OwnerDecisionSelectedValue,
  source: string,
): OwnerDecisionClientProjection | null {
  const decision = store.answer(id, selectedValue, source);
  if (!decision) return null;
  if (!decision.selectedValue) throw new Error(`owner decision ${id} was answered without a selected value`);
  return projectOwnerDecisionForClient(decision);
}

export function cancelOwnerDecisionLocal(
  store: OwnerDecisionStore,
  id: string,
  reason: string,
  source: string,
): OwnerDecisionClientProjection | null {
  const decision = store.cancel(id, reason, source);
  if (!decision) return null;
  return projectOwnerDecisionForClient(decision);
}
