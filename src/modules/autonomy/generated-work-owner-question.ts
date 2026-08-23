import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type OwnerQuestionEnqueueInput,
  OwnerQuestionQueue,
  type PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  GeneratedWorkProposalAction,
  GeneratedWorkProvenance,
} from "./generated-work-proposal-types.js";

export type ReconciledGeneratedWorkQuestion = {
  item: PendingOwnerQuestion;
  created: boolean;
  updated: boolean;
  reopened: boolean;
};

export function generatedWorkQuestionDedupeKey(proposalKey: string): string {
  return `generated-work:${proposalKey}`;
}

export function createGeneratedWorkQuestionQueue(projectDir: string): OwnerQuestionQueue {
  return new OwnerQuestionQueue(join(projectDir, ".kota", "owner-questions"));
}

export function findGeneratedWorkQuestion(
  queue: OwnerQuestionQueue,
  proposalKey: string,
): PendingOwnerQuestion | null {
  const dedupeKey = generatedWorkQuestionDedupeKey(proposalKey);
  const matches = queue.list().filter((item) => item.dedupeKey === dedupeKey);
  if (matches.length > 1) {
    throw new Error(`generated-work proposal ${proposalKey} has multiple owner questions`);
  }
  return matches[0] ?? null;
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

export function dismissGeneratedWorkQuestion(
  queue: OwnerQuestionQueue,
  proposalKey: string,
  reason: string,
  source: string,
): GeneratedWorkProposalAction[] {
  const existing = findGeneratedWorkQuestion(queue, proposalKey);
  if (!existing || existing.status !== "pending") return [];
  queue.dismiss(existing.id, reason, source);
  return [{ kind: "dismissed-owner-question", questionId: existing.id }];
}

function changedQuestion(
  existing: PendingOwnerQuestion,
  input: OwnerQuestionEnqueueInput,
): boolean {
  return existing.status !== "pending" ||
    existing.context !== input.context ||
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
  projectDir: string;
  queue: OwnerQuestionQueue;
  input: OwnerQuestionEnqueueInput & { dedupeKey: string };
}): ReconciledGeneratedWorkQuestion {
  const dedupeKey = args.input.dedupeKey.trim().toLowerCase();
  if (!dedupeKey) throw new Error("Owner question dedupeKey must not be empty");
  const input = { ...args.input, dedupeKey };
  const existing = args.queue.list().find((item) => item.dedupeKey === dedupeKey);
  if (!existing) {
    const item = args.queue.enqueue(input);
    return { item, created: true, updated: false, reopened: false };
  }
  if (
    existing.status === "pending" &&
    generatedWorkContextIdentity(existing.context) ===
      generatedWorkContextIdentity(input.context)
  ) {
    return { item: existing, created: false, updated: false, reopened: false };
  }
  if (!changedQuestion(existing, input)) {
    return { item: existing, created: false, updated: false, reopened: false };
  }
  const reopened = existing.status !== "pending";
  const item = updatedQuestion(existing, input);
  writeFileSync(
    join(args.projectDir, ".kota", "owner-questions", `${item.id}.json`),
    JSON.stringify(item, null, 2),
  );
  return { item, created: false, updated: true, reopened };
}
