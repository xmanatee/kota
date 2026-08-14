import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  projectAutonomyHealthEvidenceRefsForReview,
  projectAutonomyHealthSummariesForReview,
  projectAutonomyHealthSummaryForReview,
} from "#modules/autonomy/health-review-evidence-policy.js";
import { autonomyHealthEvidenceFingerprint } from "./health-review-evidence-fingerprint.js";
import type {
  AutonomyHealthReview,
  AutonomyHealthReviewActionResult,
  AutonomyHealthReviewArtifact,
  AutonomyHealthReviewGroup,
} from "./health-review-types.js";

export const AUTONOMY_HEALTH_REVIEW_ARTIFACT = "autonomy-health-review.json";

function projectSignalForArtifact(
  signal: AutonomyHealthReview["signals"][number],
): AutonomyHealthReview["signals"][number] {
  return {
    ...signal,
    summary: projectAutonomyHealthSummaryForReview(
      signal.summary,
      signal.evidenceRefs,
    ),
    evidenceRefs: projectAutonomyHealthEvidenceRefsForReview(signal.evidenceRefs),
  };
}

function projectGroupForArtifact(
  group: AutonomyHealthReviewGroup,
): AutonomyHealthReviewGroup {
  const evidenceRefs = projectAutonomyHealthEvidenceRefsForReview(
    group.evidenceRefs,
  );
  return {
    ...group,
    summaries: projectAutonomyHealthSummariesForReview(
      group.summaries,
      group.evidenceRefs,
    ),
    evidenceRefs,
    evidenceFingerprint: autonomyHealthEvidenceFingerprint(
      group.dedupeKey,
      evidenceRefs,
    ),
  };
}

export function projectAutonomyHealthReviewForArtifact(
  review: AutonomyHealthReview,
): AutonomyHealthReview {
  return {
    ...review,
    signals: review.signals.map(projectSignalForArtifact),
    groups: review.groups.map(projectGroupForArtifact),
  };
}

export function projectAutonomyHealthReviewArtifactForPersistence(
  artifact: AutonomyHealthReviewArtifact,
): AutonomyHealthReviewArtifact {
  return {
    ...artifact,
    review: projectAutonomyHealthReviewForArtifact(artifact.review),
  };
}

export function writeAutonomyHealthReviewArtifact(
  runDir: string,
  artifact: AutonomyHealthReviewArtifact,
): string {
  mkdirSync(runDir, { recursive: true });
  const artifactPath = join(runDir, AUTONOMY_HEALTH_REVIEW_ARTIFACT);
  const projected = projectAutonomyHealthReviewArtifactForPersistence(artifact);
  writeFileSync(artifactPath, `${JSON.stringify(projected, null, 2)}\n`, "utf-8");
  return artifactPath;
}

export function buildAutonomyHealthAttentionDigest(args: {
  review: AutonomyHealthReview;
  actions: AutonomyHealthReviewActionResult;
}): { items: Array<{ label: string; detail: string }>; text: string } {
  const groups = new Map(
    args.review.groups.map((group) => [group.dedupeKey, group]),
  );
  const items = args.actions.applied.flatMap((action) => {
    const group = groups.get(action.dedupeKey);
    if (!group) return [];
    return {
      label: "Autonomy health",
      detail:
        `${group.severity} ${group.labels.join(", ")} ${group.dedupeKey}; ` +
        `signals ${group.signalCount}; action ${action.kind}`,
    };
  });
  const text = [
    `Autonomy health review (${items.length} pattern${items.length === 1 ? "" : "s"}):`,
    ...items.map((item) => `• *${item.label}*: ${item.detail}`),
  ].join("\n");
  return { items, text };
}
