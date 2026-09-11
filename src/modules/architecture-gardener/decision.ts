import { z } from "zod";

const text = z.string().trim().min(1);
const proposalSchema = z.object({
  mechanismKey: text.regex(/^[a-z0-9][a-z0-9-]*$/),
  title: text,
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  problem: text,
  expectedOutcome: text,
  consumers: z.array(text).min(1),
  alternatives: z.array(text).min(1),
  migrationAndRetirement: text,
  preservationEvidenceNeeded: text,
  simplificationEvidenceNeeded: text,
  abstraction: z.object({
    commonBehavior: text,
    variationPoint: text,
    canonicalOwner: text,
  }).strict().nullable(),
}).strict();

const decisionSchema = z.object({
  action: z.enum(["propose", "no-action", "covered"]),
  rationale: text,
  evidenceRefs: z.array(text).min(1),
  revisit: z.object({
    reason: text,
    deliveryIssueKeys: z.array(text),
  }).strict(),
  existingTaskId: text.nullable(),
  proposal: proposalSchema.nullable(),
}).strict();

export type GardenerDecision = z.infer<typeof decisionSchema>;
export type GardenerProposal = z.infer<typeof proposalSchema>;
export const gardenerDecisionOutputSchema = z.toJSONSchema(decisionSchema);

export function decodeGardenerDecision(raw: unknown): GardenerDecision {
  const decision = decisionSchema.parse(raw);
  if ((decision.action === "propose") !== (decision.proposal !== null)) {
    throw new Error("Only a propose decision supplies a proposal");
  }
  if ((decision.action === "covered") !== (decision.existingTaskId !== null)) {
    throw new Error("Only a covered decision identifies existing work");
  }
  if (decision.proposal?.abstraction && new Set(decision.proposal.consumers).size < 2) {
    throw new Error("A harvested abstraction requires two distinct maintained consumers");
  }
  return decision;
}
