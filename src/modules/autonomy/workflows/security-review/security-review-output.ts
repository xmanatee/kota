import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const verdictSchema = z.enum(["confirmed", "rejected", "follow-up-needed"]);
const evidenceSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  excerpt: z.string().min(1),
}).strict();
const investigationFindingSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  claim: z.string().min(1),
  severity: severitySchema,
  affectedPath: z.string().min(1),
  evidence: z.array(evidenceSchema).min(1),
  recommendedOutcome: z.string().min(1),
}).strict();
const revalidatedFindingSchema = investigationFindingSchema.extend({
  verdict: verdictSchema,
  rationale: z.string().min(1),
}).strict();
const revalidationVerdictSchema = z.object({
  id: z.string().min(1),
  verdict: verdictSchema,
  rationale: z.string().min(1),
}).strict();
const investigationOutputSchema = z.object({
  findings: z.array(investigationFindingSchema),
}).strict();
const revalidationOutputSchema = z.object({
  findings: z.array(revalidatedFindingSchema),
  summary: z.string().min(1),
}).strict();
const revalidationVerdictOutputSchema = z.object({
  findings: z.array(revalidationVerdictSchema),
  summary: z.string().min(1),
}).strict();

export type SecurityFindingSeverity = z.infer<typeof severitySchema>;
export type SecurityFindingVerdict = z.infer<typeof verdictSchema>;
export type SecurityFindingEvidence = z.infer<typeof evidenceSchema>;
export type SecurityInvestigationFinding = z.infer<typeof investigationFindingSchema>;
export type SecurityRevalidatedFinding = z.infer<typeof revalidatedFindingSchema>;
export type SecurityInvestigationOutput = z.infer<typeof investigationOutputSchema>;
export type SecurityRevalidationOutput = z.infer<typeof revalidationOutputSchema>;
export type SecurityRevalidationVerdictOutput = z.infer<typeof revalidationVerdictOutputSchema>;

type RawInvestigationOutput = Parameters<typeof investigationOutputSchema.parse>[0];
type RawRevalidationOutput = Parameters<typeof revalidationVerdictOutputSchema.parse>[0];

export function decodeSecurityInvestigationOutput(
  raw: RawInvestigationOutput,
): SecurityInvestigationOutput {
  return investigationOutputSchema.parse(raw);
}

export function decodeSecurityRevalidationVerdictOutput(
  raw: RawRevalidationOutput,
): SecurityRevalidationVerdictOutput {
  return revalidationVerdictOutputSchema.parse(raw);
}

function formatFindingIds(ids: readonly string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

export function decodeSecurityRevalidationOutputForInvestigation(
  raw: RawRevalidationOutput,
  investigation: SecurityInvestigationOutput,
): SecurityRevalidationOutput {
  const output = decodeSecurityRevalidationVerdictOutput(raw);
  const expectedById = new Map(
    investigation.findings.map((finding) => [finding.id, finding]),
  );
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];
  const mergedFindings: SecurityRevalidatedFinding[] = [];

  for (const verdict of output.findings) {
    if (seenIds.has(verdict.id)) {
      duplicateIds.push(verdict.id);
      continue;
    }
    seenIds.add(verdict.id);
    const expected = expectedById.get(verdict.id);
    if (!expected) {
      unknownIds.push(verdict.id);
      continue;
    }
    mergedFindings.push({
      ...expected,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
    });
  }

  if (duplicateIds.length > 0) {
    throw new Error(
      `Security revalidation duplicated investigation finding verdicts: ${formatFindingIds(duplicateIds)}.`,
    );
  }
  if (unknownIds.length > 0) {
    throw new Error(
      `Security revalidation returned unknown investigation findings: ${formatFindingIds(unknownIds)}.`,
    );
  }

  const missingIds = investigation.findings
    .map((finding) => finding.id)
    .filter((id) => !seenIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Security revalidation omitted investigation finding verdicts: ${formatFindingIds(missingIds)}.`,
    );
  }

  return {
    findings: mergedFindings,
    summary: output.summary,
  };
}
