import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { readAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { investigationArtifact, revalidationArtifact } from "./finding-steps.js";
import { type SecurityReviewState, validateSecurityReviewState } from "./review-state.js";
import { decodeSecurityInvestigationOutput, decodeSecurityRevalidationOutput, decodeSecurityRevalidationOutputForInvestigation } from "./security-review-output.js";

const sourceIdentity = z.object({ runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) });
const metadataSchema = z.object({ id: z.string(), workflow: z.literal("security-review"), status: z.literal("success"), steps: z.array(z.object({ id: z.string(), status: z.string(), output: z.unknown().optional() })) });

type RecoveryInput = {
  state: SecurityReviewState; stateDir: string; runtimeStateDir: string; scopeId: string;
};

/** Legacy outputs have no digest. Require the successful scoped source run,
 * both complete artifact projections, and exactly one matching confirmed entry.
 * This recovers retained evidence; it never executes a review or writes a task. */
export async function collectSecurityEvidenceRecovery(input: RecoveryInput): Promise<SecurityReviewState["recovery"]> {
  const recovery = structuredClone(input.state.recovery);
  for (let index = 0; index < recovery.length; index += 1) {
    const held = recovery[index]!;
    if (held.disposition !== "parked-invalid-evidence") continue;
    try {
      const { runId } = sourceIdentity.parse(held.original);
      const authority = RunStateDatabase.openReadOnly(input.runtimeStateDir);
      try {
        const run = authority.getRun(runId);
        if (!run || run.scopeId !== input.scopeId || run.workflow !== "security-review" || run.state !== "succeeded") {
          throw new Error("Successful security-review source run is unavailable in this scope");
        }
      } finally { authority.close(); }
      const names = ["metadata.json", "security-review-investigation.json", "security-review-revalidation.json"];
      // Full domain artifacts can exceed the excerpt batch reader's limit.
      // This operation already runs in the shared blocking worker.
      const files = names.map((name) => readAnchoredTextFile({
        rootPath: input.stateDir, boundaryDir: join(input.stateDir, "runs"),
        filePath: join(input.stateDir, "runs", runId, name),
      }));
      const contents = files.map((file) => {
        if (!file) throw new Error("Retained source artifact is unavailable or unsafe");
        return file.content;
      });
      const metadata = metadataSchema.parse(JSON.parse(contents[0]!));
      if (metadata.id !== runId) throw new Error("Retained metadata source identity differs");
      const investigation = decodeSecurityInvestigationOutput(JSON.parse(contents[1]!));
      const revalidation = decodeSecurityRevalidationOutput(JSON.parse(contents[2]!));
      const expected = decodeSecurityRevalidationOutputForInvestigation({
        findings: revalidation.findings.map(({ id, verdict, rationale }) => ({ id, verdict, rationale })), summary: revalidation.summary,
      }, investigation);
      if (!isDeepStrictEqual(expected, revalidation)) throw new Error("Source investigation and revalidation disagree");
      for (const [id, output] of [["record-investigation-findings", investigation], ["record-revalidation", revalidation]] as const) {
        const step = metadata.steps.find((entry) => entry.id === id && entry.status === "success");
        const stored = z.object({ artifactPath: z.string() }).passthrough().parse(step?.output);
        const { artifactPath: _path, ...projection } = stored;
        if (!isDeepStrictEqual(projectEvidenceObject(output, "internal-storage"), projection)) {
          throw new Error("Source artifact does not match the retained step projection");
        }
      }
      const matches = revalidation.findings.filter((finding) => finding.verdict === "confirmed" &&
        isDeepStrictEqual(projectEvidenceObject({ runId, finding }, "internal-storage"), held.original));
      if (matches.length !== 1) throw new Error("Retained projection does not identify one confirmed source finding");
      const finding = matches[0]!;
      recovery[index] = {
        original: held.original, reason: held.reason, disposition: "reconciled-from-source-artifacts",
        source: {
          entry: { runId, finding: { ...finding, verdict: "confirmed" } },
          investigation: { runId, sha256: createHash("sha256").update(contents[1]!).digest("hex") },
          revalidation: { runId, sha256: createHash("sha256").update(contents[2]!).digest("hex") },
        },
      };
    } catch (error) {
      held.attemptError = error instanceof Error ? error.message : String(error);
    }
  }
  return recovery;
}

/** Merge against fresh state during the shared success transaction. A changed
 * artifact or concurrent disposition leaves the retained evidence parked. */
export function reconcileSecurityEvidenceRecovery(state: SecurityReviewState, observed: SecurityReviewState["recovery"], runDir: string): void {
  for (let index = 0; index < state.recovery.length; index += 1) {
    const held = state.recovery[index]!;
    if (held.disposition !== "parked-invalid-evidence") continue;
    const candidate = observed.find((entry) => isDeepStrictEqual(entry.original, held.original));
    if (!candidate) continue;
    if (candidate.disposition === "parked-invalid-evidence") {
      state.recovery[index] = candidate;
      continue;
    }
    try {
      validateSecurityReviewState({ ...state, recovery: [candidate] });
      const { runId } = sourceIdentity.parse(held.original);
      if (candidate.source.investigation.runId !== runId || candidate.source.revalidation.runId !== runId || candidate.source.entry.runId !== runId) throw new Error("Recovery source identity changed");
      const investigation = investigationArtifact.read(runDir, candidate.source.investigation);
      const revalidation = revalidationArtifact.read(runDir, candidate.source.revalidation);
      const expected = decodeSecurityRevalidationOutputForInvestigation({
        findings: revalidation.findings.map(({ id, verdict, rationale }) => ({ id, verdict, rationale })), summary: revalidation.summary,
      }, investigation);
      if (!isDeepStrictEqual(expected, revalidation) ||
        !revalidation.findings.some((finding) => isDeepStrictEqual(finding, candidate.source.entry.finding)) ||
        !isDeepStrictEqual(projectEvidenceObject(candidate.source.entry, "internal-storage"), held.original)) throw new Error("Recovered finding differs from its source evidence");
      if (!state.pending.some((entry) => isDeepStrictEqual(entry, candidate.source.entry))) state.pending.push(candidate.source.entry);
      state.recovery[index] = candidate;
    } catch (error) {
      held.attemptError = error instanceof Error ? error.message : String(error);
    }
  }
}

export const securityEvidenceRecoveryOperation = defineWorkflowBlockingOperation<RecoveryInput, SecurityReviewState["recovery"]>(import.meta.url, "collectSecurityEvidenceRecovery");
