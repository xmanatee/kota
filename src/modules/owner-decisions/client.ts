import type {
  OwnerDecisionClientProjection,
  OwnerDecisionSelectedValue,
  OwnerDecisionStatus,
} from "#core/daemon/owner-decision-store.js";

export type OwnerDecisionListFilter = {
  status?: OwnerDecisionStatus | "all";
  projectId?: string;
};

export type OwnerDecisionProjectScope = {
  projectId?: string;
};

export type OwnerDecisionListResult = {
  decisions: OwnerDecisionClientProjection[];
};

export type OwnerDecisionShowResult =
  | { found: true; decision: OwnerDecisionClientProjection }
  | { found: false };

export type OwnerDecisionMutateResult =
  | { ok: true; decision: OwnerDecisionClientProjection }
  | { ok: false; reason: "not_found" };

export interface OwnerDecisionsClient {
  list(filter?: OwnerDecisionListFilter): Promise<OwnerDecisionListResult>;
  show(id: string, project?: OwnerDecisionProjectScope): Promise<OwnerDecisionShowResult>;
  answer(
    id: string,
    selectedValue: OwnerDecisionSelectedValue,
    project?: OwnerDecisionProjectScope,
  ): Promise<OwnerDecisionMutateResult>;
  cancel(
    id: string,
    reason: string,
    project?: OwnerDecisionProjectScope,
  ): Promise<OwnerDecisionMutateResult>;
}
