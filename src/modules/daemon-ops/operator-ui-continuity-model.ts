import type { UiRole } from "./operator-ui-types.js";

export type ContinuityState = "empty" | "healthy" | "blocked" | "failed";

export type ContinuityEntry = {
  id: string;
  name: string;
  state: string;
  detail: string;
  role: UiRole;
  route?: { method: "GET"; path: string; label: string };
};

export type ContinuityProjection = {
  scopeId: string;
  state: ContinuityState;
  summary: string;
  nextAction: string;
  composedStores: readonly string[];
  counts: {
    workItems: number;
    unblocks: number;
    failedRuns: number;
    reviewArtifacts: number;
    memoryHints: number;
    knowledgeHints: number;
    recurringFollowUps: number;
  };
  workItems: readonly ContinuityEntry[];
  unblocks: readonly ContinuityEntry[];
  reviewArtifacts: readonly ContinuityEntry[];
  memoryKnowledgeHints: readonly ContinuityEntry[];
  recurringFollowUps: readonly ContinuityEntry[];
};

export const CONTINUITY_COMPOSED_STORES = [
  "tasks.list",
  "workflow.status",
  "workflow.listRuns",
  "workflow.listDefinitions",
  "approvals.list",
  "ownerQuestions.list",
  "ownerDecisions.list",
  "setup.list",
  "memory.list",
  "knowledge.list",
] as const;
