import type { LoopQualityCheckId } from "./loop-quality-audit-types.js";

export const CHECKS: readonly LoopQualityCheckId[] = [
  "completion-evidence",
  "repeat-brake",
  "no-progress-detection",
  "context-hygiene",
  "mutating-retry-safety",
  "independent-verifier",
  "human-gate",
  "workflow-completed-self-trigger",
];

export const COMPLETION_CHECK_IDS = [
  "completion-evidence",
  "task-contract",
  "actionable-task",
  "task-resolved",
  "task-queue",
  "critic",
  "semantic",
  "validate",
  "test",
];

export const VERIFIER_CHECK_IDS = [
  "critic",
  "semantic",
  "test",
  "typecheck",
  "validate",
  "task-queue",
  "repo-hygiene",
  "module-boundary",
  "doc-bloat",
];

export const CONTEXT_CHECK_IDS = [
  "task-contract",
  "artifact",
  "summary",
  "scratch",
  "observability",
];

export const MUTATION_SAFETY_IDS = [
  "task-queue",
  "no-scratch",
  "artifact",
  "mark-attempt",
  "record-evidence",
  "dedupe",
  "idempot",
];

export const RISKY_TOOL_PATTERN = /\b(delete|deploy|publish|release|send|post|merge|pay|charge|book|cancel|prod|production)\b/i;
export const CONTEXT_STEP_PATTERN = /\b(gather|inspect|assess|artifact|summary|fingerprint|evidence|review)\b/i;
export const NO_PROGRESS_STEP_PATTERN = /\b(gate|inspect|assess|precondition|fingerprint|mark|record)\b/i;
export const MUTATION_STEP_PATTERN = /\b(commit|write|apply|create|move|delete|mark|record|cleanup|merge|release)\b/i;
