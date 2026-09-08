import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type OwnerQuestionEnqueueInput,
  OwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import {
  type OwnerQuestionMutationRequest,
  ownerQuestionMutationKey,
} from "#modules/owner-questions/events.js";
import type {
  GeneratedWorkProposalAction,
  GeneratedWorkProvenance,
} from "./generated-work-proposal-types.js";

const DISPOSITION_RESOLUTION_SOURCE = "generated-work-disposition:";

export type ReconciledGeneratedWorkQuestion = {
  item: PendingOwnerQuestion;
  created: boolean;
  updated: boolean;
  reopened: boolean;
};

export function generatedWorkQuestionDedupeKey(proposalKey: string): string {
  return `generated-work:${proposalKey}`;
}

export function createGeneratedWorkQuestionQueue(workspaceRoot: string): OwnerQuestionQueue {
  return new OwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
}

export function findGeneratedWorkQuestion(
  queue: OwnerQuestionQueue,
  proposalKey: string,
): PendingOwnerQuestion | null {
  return findCurrentQuestion(queue, generatedWorkQuestionDedupeKey(proposalKey));
}

function findCurrentQuestion(
  queue: OwnerQuestionQueue,
  key: string,
): PendingOwnerQuestion | null {
  const dedupeKey = key.trim().toLowerCase();
  if (!dedupeKey) throw new Error("Owner question dedupeKey must not be empty");
  const matches = queue.list().filter((item) => item.dedupeKey === dedupeKey);
  const pending = matches.filter((item) => item.status === "pending");
  if (pending.length > 1) {
    throw new Error(`generated-work key ${dedupeKey} has multiple pending owner questions`);
  }
  return pending[0] ?? matches.at(-1) ?? null;
}

export function generatedWorkProvenanceContext(
  context: string,
  proposalKey: string,
  provenance: GeneratedWorkProvenance,
): string {
  const refs = [...new Set(provenance.evidenceRefs)].sort().join(", ") || "none";
  const issue = provenance.issueKey
    ? `; issue ${provenance.issueKey}; revision ${provenance.semanticRevision ?? "unknown"}`
    : "";
  return [
    context.trim(),
    `Generated-work proposal ${proposalKey}; source ${provenance.source}${issue}; ` +
      `evidence ${refs}.`,
  ].join("\n\n");
}

function generatedWorkContextIdentity(context: string): string | null {
  const identity = context.trim().split("\n\n").at(-1) ?? "";
  return identity.startsWith("Generated-work proposal ") ? identity : null;
}

export function planGeneratedWorkQuestionDismissals(args: {
  queue: OwnerQuestionQueue;
  proposalKey: string;
  linkedQuestionIds: readonly string[];
  reason: string;
  source: string;
}): OwnerQuestionMutationRequest[] {
  const existing = findGeneratedWorkQuestion(args.queue, args.proposalKey);
  const ids = new Set(args.linkedQuestionIds);
  if (existing) ids.add(existing.id);
  return [...ids].sort().flatMap((questionId): OwnerQuestionMutationRequest[] => {
    if (args.queue.get(questionId)?.status !== "pending") return [];
    return [{
      questionId,
      mutation: "dismiss",
      reason: args.reason,
      resolutionSource: `${DISPOSITION_RESOLUTION_SOURCE}${args.source}`,
      idempotencyKey: ownerQuestionMutationKey(questionId),
    }];
  });
}

export function dismissGeneratedWorkQuestion(
  queue: OwnerQuestionQueue,
  proposalKey: string,
  reason: string,
  source: string,
): GeneratedWorkProposalAction[] {
  return planGeneratedWorkQuestionDismissals({
    queue, proposalKey, linkedQuestionIds: [], reason, source,
  }).map((mutation) => {
    queue.dismiss(mutation.questionId, mutation.reason, mutation.resolutionSource);
    return { kind: "dismissed-owner-question", questionId: mutation.questionId };
  });
}

function changedQuestion(
  existing: PendingOwnerQuestion,
  input: OwnerQuestionEnqueueInput,
): boolean {
  return existing.context !== input.context ||
    existing.question !== input.question ||
    existing.reason !== input.reason ||
    existing.source !== input.source ||
    existing.answerBehavior !== input.answerBehavior ||
    JSON.stringify(existing.proposedAnswers ?? []) !==
      JSON.stringify(input.proposedAnswers ?? []) ||
    existing.timeoutMs !== input.timeoutMs ||
    existing.defaultResolution !== input.defaultResolution ||
    existing.defaultAnswer !== input.defaultAnswer;
}

function updatedQuestion(
  existing: PendingOwnerQuestion,
  input: OwnerQuestionEnqueueInput & { dedupeKey: string },
): PendingOwnerQuestion {
  const item: PendingOwnerQuestion = {
    ...existing,
    dedupeKey: input.dedupeKey,
    context: input.context,
    question: input.question,
    reason: input.reason,
    source: input.source,
    answerBehavior: input.answerBehavior,
    origin: input.origin,
    status: "pending",
    ...(input.proposedAnswers && input.proposedAnswers.length > 0
      ? { proposedAnswers: input.proposedAnswers }
      : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.defaultResolution !== undefined
      ? { defaultResolution: input.defaultResolution }
      : {}),
    ...(input.defaultAnswer !== undefined ? { defaultAnswer: input.defaultAnswer } : {}),
  };
  delete item.resolvedAt;
  delete item.answer;
  delete item.dismissalReason;
  delete item.resolutionSource;
  if (!input.proposedAnswers || input.proposedAnswers.length === 0) delete item.proposedAnswers;
  if (input.timeoutMs === undefined) delete item.timeoutMs;
  if (input.defaultResolution === undefined) delete item.defaultResolution;
  if (input.defaultAnswer === undefined) delete item.defaultAnswer;
  return item;
}

export function reconcileGeneratedWorkQuestion(args: {
  workspaceRoot: string;
  queue: OwnerQuestionQueue;
  input: OwnerQuestionEnqueueInput & { dedupeKey: string };
}): ReconciledGeneratedWorkQuestion {
  const dedupeKey = args.input.dedupeKey.trim().toLowerCase();
  if (!dedupeKey) throw new Error("Owner question dedupeKey must not be empty");
  const input = { ...args.input, dedupeKey };
  const existing = findCurrentQuestion(args.queue, dedupeKey);
  if (!existing) {
    const item = args.queue.enqueue(input);
    return { item, created: true, updated: false, reopened: false };
  }
  if (existing.status === "dismissed" &&
    existing.resolutionSource?.startsWith(DISPOSITION_RESOLUTION_SOURCE)) {
    const item = args.queue.enqueue(input);
    return { item, created: false, updated: false, reopened: true };
  }
  if (
    generatedWorkContextIdentity(existing.context) ===
      generatedWorkContextIdentity(input.context) &&
    !changedQuestion(existing, { ...input, context: existing.context })
  ) {
    return { item: existing, created: false, updated: false, reopened: false };
  }
  if (!changedQuestion(existing, input)) {
    return { item: existing, created: false, updated: false, reopened: false };
  }
  if (existing.status !== "pending") {
    const item = args.queue.enqueue(input);
    return { item, created: false, updated: false, reopened: true };
  }
  const item = updatedQuestion(existing, input);
  writeFileSync(
    join(args.workspaceRoot, ".kota", "owner-questions", `${item.id}.json`),
    JSON.stringify(item, null, 2),
  );
  return { item, created: false, updated: true, reopened: false };
}
