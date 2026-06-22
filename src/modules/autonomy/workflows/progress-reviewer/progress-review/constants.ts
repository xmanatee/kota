import type { ProgressReviewEvidenceRef } from "./types.js";

export const PROGRESS_REVIEW_ARTIFACT = "progress-review.json";
export const PROGRESS_REVIEW_EVIDENCE_ARTIFACT = "progress-review-evidence.json";
export const PROGRESS_REVIEW_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PROGRESS_REVIEW_MAX_RUNS = 20;
export const PROGRESS_REVIEW_MAX_TASKS = 20;
export const PROGRESS_REVIEW_MAX_EVENTS = 30;
export const PROGRESS_REVIEW_MAX_ARTIFACTS = 40;
export const PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH = 6;
export const PROGRESS_REVIEW_MAX_GIT_ENTRIES = 60;
export const PROGRESS_REVIEW_MAX_GIT_STATUS_LINES = 20;
export const PROGRESS_REVIEW_MAX_GIT_COMMITS = 10;
export const PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT = 12;
export const PROGRESS_REVIEW_MAX_APPROVALS = 20;
export const PROGRESS_REVIEW_MAX_DEAD_LETTERS = 20;
export const PROGRESS_REVIEW_AGENT_MAX_EVIDENCE = 120;
export const PROGRESS_REVIEW_SCHEDULE_EVENT = "autonomy.progress-review.scheduled";

export const PROGRESS_REVIEW_AGENT_KIND_LIMITS = {
  run: 20,
  task: 20,
  event: 20,
  artifact: 16,
  git: 16,
  "owner-question": 10,
  approval: 10,
  "dead-letter": 20,
} satisfies Record<ProgressReviewEvidenceRef["kind"], number>;
