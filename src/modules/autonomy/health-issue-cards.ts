import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  projectAutonomyHealthEvidenceRefsForReview,
  projectAutonomyHealthSummariesForReview,
} from "./health-review-evidence-policy.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthJsonValue,
  AutonomyHealthSeverity,
} from "./health-signal.js";
import { isAutonomyHealthJsonObject } from "./health-signal.js";
import { AUTONOMY_HEALTH_REVIEW_ARTIFACT } from "./workflows/autonomy-health-reviewer/health-review.js";

export type AutonomyHealthIssueCard = {
  reviewedAt: string;
  dedupeKey: string;
  severity: AutonomyHealthSeverity;
  labels: string[];
  actionability: AutonomyHealthActionability;
  signalCount: number;
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  createdTaskIds: string[];
  ownerQuestionIds: string[];
};

export type AutonomyHealthIssueEvidence = {
  generatedAt: string;
  latestHealthReviewAt: string | null;
  issueCards: AutonomyHealthIssueCard[];
};

type RawReviewArtifact = {
  generatedAt?: AutonomyHealthJsonValue;
  review?: AutonomyHealthJsonValue;
  actions?: AutonomyHealthJsonValue;
};

type ReviewArtifactEntry = {
  generatedAt: string;
  groups: AutonomyHealthJsonValue[];
  createdTaskIds: string[];
  ownerQuestionIds: string[];
};

const DEFAULT_CARD_LIMIT = 12;
const MAX_SUMMARIES_PER_CARD = 3;
const MAX_EVIDENCE_REFS_PER_CARD = 5;

function isSeverity(
  value: AutonomyHealthJsonValue | undefined,
): value is AutonomyHealthSeverity {
  return (
    value === "info" ||
    value === "warning" ||
    value === "error" ||
    value === "critical"
  );
}

function isActionability(
  value: AutonomyHealthJsonValue | undefined,
): value is AutonomyHealthActionability {
  return (
    value === "local-code" ||
    value === "owner-action" ||
    value === "external-service" ||
    value === "informational"
  );
}

function stringArray(value: AutonomyHealthJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function evidenceRefs(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const refs: AutonomyHealthEvidenceRef[] = [];
  for (const entry of value) {
    if (!isAutonomyHealthJsonObject(entry)) continue;
    const { kind, ref, summary } = entry;
    if (
      kind !== "run" &&
      kind !== "event" &&
      kind !== "task" &&
      kind !== "dead-letter" &&
      kind !== "module-log" &&
      kind !== "git" &&
      kind !== "artifact"
    ) {
      continue;
    }
    if (typeof ref !== "string" || ref.trim().length === 0) continue;
    refs.push({
      kind,
      ref,
      ...(typeof summary === "string" && summary.trim().length > 0
        ? { summary }
        : {}),
    });
  }
  return refs;
}

function readJson(path: string): RawReviewArtifact | null {
  const raw = readOptionalJsonFile<AutonomyHealthJsonValue>(path);
  return isAutonomyHealthJsonObject(raw) ? raw : null;
}

function cardFromGroup(args: {
  group: AutonomyHealthJsonValue | undefined;
  reviewedAt: string;
  createdTaskIds: string[];
  ownerQuestionIds: string[];
}): AutonomyHealthIssueCard | null {
  if (!isAutonomyHealthJsonObject(args.group)) return null;
  const dedupeKey = args.group.dedupeKey;
  const severity = args.group.severity;
  const actionability = args.group.actionability;
  const signalCount = args.group.signalCount;
  if (
    typeof dedupeKey !== "string" ||
    !isSeverity(severity) ||
    !isActionability(actionability) ||
    typeof signalCount !== "number"
  ) {
    return null;
  }
  const rawEvidenceRefs = evidenceRefs(args.group.evidenceRefs);
  return {
    reviewedAt: args.reviewedAt,
    dedupeKey,
    severity,
    labels: stringArray(args.group.labels),
    actionability,
    signalCount,
    summaries: projectAutonomyHealthSummariesForReview(
      stringArray(args.group.summaries),
      rawEvidenceRefs,
    ).slice(0, MAX_SUMMARIES_PER_CARD),
    evidenceRefs:
      projectAutonomyHealthEvidenceRefsForReview(rawEvidenceRefs).slice(
        0,
        MAX_EVIDENCE_REFS_PER_CARD,
      ),
    createdTaskIds: args.createdTaskIds,
    ownerQuestionIds: args.ownerQuestionIds,
  };
}

function compareIsoDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

export function collectRecentAutonomyHealthIssueCards(
  runsDir: string,
  options: { limit?: number; nowIso?: string } = {},
): AutonomyHealthIssueEvidence {
  const generatedAt = options.nowIso ?? new Date().toISOString();
  if (!existsSync(runsDir)) {
    return { generatedAt, latestHealthReviewAt: null, issueCards: [] };
  }

  const reviewArtifacts: ReviewArtifactEntry[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifactPath = join(runsDir, entry.name, AUTONOMY_HEALTH_REVIEW_ARTIFACT);
    if (!existsSync(artifactPath)) continue;
    const artifact = readJson(artifactPath);
    if (!artifact || typeof artifact.generatedAt !== "string") continue;
    const review = isAutonomyHealthJsonObject(artifact.review)
      ? artifact.review
      : undefined;
    const groups = review?.groups;
    if (!Array.isArray(groups)) continue;
    const actions = isAutonomyHealthJsonObject(artifact.actions)
      ? artifact.actions
      : undefined;
    reviewArtifacts.push({
      generatedAt: artifact.generatedAt,
      groups,
      createdTaskIds: stringArray(actions?.createdTaskIds),
      ownerQuestionIds: stringArray(actions?.ownerQuestionIds),
    });
  }

  const latestHealthReviewAt =
    reviewArtifacts.length > 0
      ? reviewArtifacts.map((entry) => entry.generatedAt).sort(compareIsoDesc)[0]!
      : null;
  const cardsByDedupe = new Map<string, AutonomyHealthIssueCard>();
  if (latestHealthReviewAt) {
    for (const artifact of reviewArtifacts) {
      if (artifact.generatedAt !== latestHealthReviewAt) continue;
      for (const group of artifact.groups) {
        const card = cardFromGroup({
          group,
          reviewedAt: artifact.generatedAt,
          createdTaskIds: artifact.createdTaskIds,
          ownerQuestionIds: artifact.ownerQuestionIds,
        });
        if (!card) continue;
        const existing = cardsByDedupe.get(card.dedupeKey);
        if (existing && existing.reviewedAt >= card.reviewedAt) continue;
        cardsByDedupe.set(card.dedupeKey, card);
      }
    }
  }

  const limit = options.limit ?? DEFAULT_CARD_LIMIT;
  const issueCards = [...cardsByDedupe.values()]
    .sort((a, b) => compareIsoDesc(a.reviewedAt, b.reviewedAt))
    .slice(0, limit);
  return { generatedAt, latestHealthReviewAt, issueCards };
}
