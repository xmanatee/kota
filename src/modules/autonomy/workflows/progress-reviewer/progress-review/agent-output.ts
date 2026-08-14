import { z } from "zod";
import { assertProgressReviewPrunedEvidenceRef } from "./pruned-evidence.js";
import type {
  ProgressReviewAgentOutput,
  ProgressReviewEvidenceIdPacket,
  ProgressReviewFindingGroup,
} from "./types.js";

const reviewClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  confidence: z.enum(["low", "medium", "high"]),
}).strict();

const reviewFollowUpTaskSchema = z.object({
  topicKey: z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  area: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  acceptanceEvidence: z.string().min(1),
}).strict();

const reviewOwnerQuestionSchema = z.object({
  topicKey: z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/),
  question: z.string().min(1),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  proposedAnswers: z.array(z.string().min(1)).min(1).optional(),
}).strict();

const reviewFindingGroupSchema = z.object({
  claims: z.array(reviewClaimSchema),
  followUpTasks: z.array(reviewFollowUpTaskSchema),
}).strict();

const progressReviewAgentOutputSchema = z.object({
  verdict: z.enum([
    "on-track",
    "needs-steering",
    "blocked",
    "insufficient-evidence",
  ]),
  summary: z.string().min(1),
  findings: z.object({
    crossScope: reviewFindingGroupSchema,
    localScope: reviewFindingGroupSchema,
  }).strict(),
  ownerQuestions: z.array(reviewOwnerQuestionSchema),
}).strict();

export function decodeProgressReviewAgentOutput(
  raw: Parameters<typeof progressReviewAgentOutputSchema.parse>[0],
): ProgressReviewAgentOutput {
  return progressReviewAgentOutputSchema.parse(raw);
}

export function progressReviewFindingGroupEntries(review: ProgressReviewAgentOutput): readonly {
  label: string;
  group: ProgressReviewFindingGroup;
}[] {
  return [
    { label: "cross-scope", group: review.findings.crossScope },
    { label: "local-scope", group: review.findings.localScope },
  ];
}

function evidenceIdsForPacket(packet: ProgressReviewEvidenceIdPacket): Set<string> {
  const ids = new Set<string>();
  for (const evidence of packet.evidence) {
    assertProgressReviewPrunedEvidenceRef(evidence);
    if (ids.has(evidence.id)) {
      throw new Error(`progress-review evidence packet contains duplicate id: ${evidence.id}`);
    }
    ids.add(evidence.id);
  }
  return ids;
}

function assertKnownEvidenceIds(args: {
  knownIds: ReadonlySet<string>;
  field: string;
  evidenceIds: readonly string[];
}): void {
  const unknown = args.evidenceIds.filter((id) => !args.knownIds.has(id));
  if (unknown.length === 0) return;
  throw new Error(
    `progress-review ${args.field} cites unknown evidence id(s): ${unknown.join(", ")}`,
  );
}

function resolveCompactedChildEvidenceId(
  id: string,
  evidence: ProgressReviewEvidenceIdPacket,
  knownIds: ReadonlySet<string>,
  siblingEvidenceIds: readonly string[],
): string | null {
  const gitCommitFile = id.match(/^(.*git:commit:[^:]+):file:\d+$/);
  if (gitCommitFile?.[1] && knownIds.has(gitCommitFile[1])) {
    return gitCommitFile[1];
  }

  const artifact = id.match(/^(.*)artifact:([^:]+):.+$/);
  if (artifact?.[1] !== undefined && artifact[2]) {
    const runId = `${artifact[1]}run:${artifact[2]}`;
    if (knownIds.has(runId)) return runId;
  }

  const journalEvent = id.match(/^(.*)event:evtj-[^:]+$/);
  if (journalEvent?.[1] !== undefined) {
    const prefix = journalEvent[1] ?? "";
    const runParents = [
      ...new Set(
        siblingEvidenceIds.filter(
          (candidate) =>
            candidate.startsWith(`${prefix}run:`) && knownIds.has(candidate),
        ),
      ),
    ];
    return runParents.length === 1 ? runParents[0] ?? null : null;
  }

  const run = id.match(/^(.*)run:([^:]+)$/);
  if (!run?.[2]) return null;
  const prefix = run[1] ?? "";
  const runId = run[2];
  const eventParents = evidence.evidence.filter(
    (item) =>
      item.kind === "event" &&
      item.id.startsWith(prefix) &&
      item.summary.includes(runId),
  );
  return eventParents.length === 1 ? eventParents[0]?.id ?? null : null;
}

function normalizeEvidenceIds(args: {
  evidence: ProgressReviewEvidenceIdPacket;
  fullEvidence?: ProgressReviewEvidenceIdPacket;
  knownIds: ReadonlySet<string>;
  fullKnownIds?: ReadonlySet<string>;
  field: string;
  evidenceIds: readonly string[];
}): string[] {
  const normalized: string[] = [];
  const unknown: string[] = [];
  for (const id of args.evidenceIds) {
    const knownId =
      (args.knownIds.has(id)
        ? id
        : resolveCompactedChildEvidenceId(
            id,
            args.evidence,
            args.knownIds,
            args.evidenceIds,
          )) ??
      (args.fullKnownIds?.has(id) ? id : null) ??
      (args.fullEvidence && args.fullKnownIds
        ? resolveCompactedChildEvidenceId(
            id,
            args.fullEvidence,
            args.fullKnownIds,
            args.evidenceIds,
          )
        : null);
    if (!knownId) {
      unknown.push(id);
      continue;
    }
    if (!normalized.includes(knownId)) normalized.push(knownId);
  }
  if (unknown.length > 0) {
    throw new Error(
      `progress-review ${args.field} cites unknown evidence id(s): ${unknown.join(", ")}`,
    );
  }
  return normalized;
}

function normalizeFindingGroupEvidenceIds(args: {
  evidence: ProgressReviewEvidenceIdPacket;
  fullEvidence?: ProgressReviewEvidenceIdPacket;
  knownIds: ReadonlySet<string>;
  fullKnownIds?: ReadonlySet<string>;
  label: string;
  group: ProgressReviewFindingGroup;
}): ProgressReviewFindingGroup {
  return {
    claims: args.group.claims.map((claim) => ({
      ...claim,
      evidenceIds: normalizeEvidenceIds({
        evidence: args.evidence,
        fullEvidence: args.fullEvidence,
        knownIds: args.knownIds,
        fullKnownIds: args.fullKnownIds,
        field: `${args.label} claim ${claim.id}`,
        evidenceIds: claim.evidenceIds,
      }),
    })),
    followUpTasks: args.group.followUpTasks.map((task) => ({
      ...task,
      evidenceIds: normalizeEvidenceIds({
        evidence: args.evidence,
        fullEvidence: args.fullEvidence,
        knownIds: args.knownIds,
        fullKnownIds: args.fullKnownIds,
        field: `${args.label} follow-up task "${task.title}"`,
        evidenceIds: task.evidenceIds,
      }),
    })),
  };
}

function normalizeProgressReviewEvidenceIds(args: {
  evidence: ProgressReviewEvidenceIdPacket;
  fullEvidence?: ProgressReviewEvidenceIdPacket;
  review: ProgressReviewAgentOutput;
}): ProgressReviewAgentOutput {
  const knownIds = evidenceIdsForPacket(args.evidence);
  const fullKnownIds = args.fullEvidence
    ? evidenceIdsForPacket(args.fullEvidence)
    : undefined;
  return {
    ...args.review,
    findings: {
      crossScope: normalizeFindingGroupEvidenceIds({
        evidence: args.evidence,
        fullEvidence: args.fullEvidence,
        knownIds,
        fullKnownIds,
        label: "cross-scope",
        group: args.review.findings.crossScope,
      }),
      localScope: normalizeFindingGroupEvidenceIds({
        evidence: args.evidence,
        fullEvidence: args.fullEvidence,
        knownIds,
        fullKnownIds,
        label: "local-scope",
        group: args.review.findings.localScope,
      }),
    },
    ownerQuestions: args.review.ownerQuestions.map((question) => ({
      ...question,
      evidenceIds: normalizeEvidenceIds({
        evidence: args.evidence,
        fullEvidence: args.fullEvidence,
        knownIds,
        fullKnownIds,
        field: `owner question "${question.question}"`,
        evidenceIds: question.evidenceIds,
      }),
    })),
  };
}

export function validateProgressReviewEvidenceIds(args: {
  evidence: ProgressReviewEvidenceIdPacket;
  review: ProgressReviewAgentOutput;
}): void {
  const knownIds = evidenceIdsForPacket(args.evidence);
  for (const { label, group } of progressReviewFindingGroupEntries(args.review)) {
    for (const claim of group.claims) {
      assertKnownEvidenceIds({
        knownIds,
        field: `${label} claim ${claim.id}`,
        evidenceIds: claim.evidenceIds,
      });
    }
    for (const task of group.followUpTasks) {
      assertKnownEvidenceIds({
        knownIds,
        field: `${label} follow-up task "${task.title}"`,
        evidenceIds: task.evidenceIds,
      });
    }
  }
  for (const question of args.review.ownerQuestions) {
    assertKnownEvidenceIds({
      knownIds,
      field: `owner question "${question.question}"`,
      evidenceIds: question.evidenceIds,
    });
  }
}

export function decodeProgressReviewAgentOutputForEvidence(
  raw: Parameters<typeof progressReviewAgentOutputSchema.parse>[0],
  evidence: ProgressReviewEvidenceIdPacket,
  fullEvidence?: ProgressReviewEvidenceIdPacket,
): ProgressReviewAgentOutput {
  const review = decodeProgressReviewAgentOutput(raw);
  return normalizeProgressReviewEvidenceIds({ evidence, fullEvidence, review });
}
