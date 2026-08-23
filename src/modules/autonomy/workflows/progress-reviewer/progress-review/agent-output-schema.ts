import { z } from "zod";
import type { ProgressReviewAgentOutput } from "./types.js";

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

const reviewResolutionSchema = z.object({
  topicKey: z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
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
  resolutions: z.array(reviewResolutionSchema).optional().default([]),
}).strict();

export function decodeProgressReviewAgentOutput(
  raw: Parameters<typeof progressReviewAgentOutputSchema.parse>[0],
): ProgressReviewAgentOutput {
  return progressReviewAgentOutputSchema.parse(raw);
}
