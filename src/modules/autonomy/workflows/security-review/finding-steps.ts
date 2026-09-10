import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { refreshReviewInput, scanCandidates } from "./candidate-steps.js";
import { refreshedReviewInputArtifact } from "./review-input-artifact.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "./review-state.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  writeJsonArtifact,
} from "./security-review.js";
import { resolveSecurityFindingTaskTarget, securityFindingEvidenceKey, securityFindingFamilyKey } from "./security-review-task-identity.js";

function investigationOutput(
  ctx: WorkflowStepContext,
): SecurityInvestigationOutput | undefined {
  if (!stepSucceeded("investigate-candidates")(ctx)) return undefined;
  const raw = ctx.stepOutputs["investigate-candidates"];
  return raw === undefined ? undefined : decodeSecurityInvestigationOutput(raw);
}

export const recordInvestigationFindings = typedCodeStep<
  SecurityInvestigationOutput & { artifactPath: string }
>({
  id: "record-investigation-findings",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("investigate-candidates"),
  validate: (raw) =>
    expectStructuredOutput<
      SecurityInvestigationOutput & { artifactPath: string }
    >(raw, ["findings", "artifactPath"]),
  run: (ctx) => {
    const output = investigationOutput(ctx);
    if (!output) throw new Error("Security investigation is missing");
    const packet = scanCandidates.outputRequired(ctx);
    const selectedPaths = new Set(packet.candidates.map((candidate) => candidate.path));
    const covered = new Set<string>();
    for (const coverage of output.coverage) {
      if (!selectedPaths.has(coverage.path) || covered.has(coverage.path)) throw new Error("Security coverage must cite each selected path once");
      covered.add(coverage.path);
    }
    if (covered.size !== selectedPaths.size) throw new Error("Security investigation omitted candidate coverage");
    for (const finding of output.findings) {
      if (!packet.candidates.some((candidate) => candidate.id === finding.candidateId)) throw new Error("Security finding cites an unknown candidate");
    }
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-investigation.json",
      output,
    );
    return { ...output, artifactPath };
  },
});

function revalidationOutput(
  ctx: WorkflowStepContext,
): SecurityRevalidationOutput | undefined {
  if (!stepSucceeded("revalidate-findings")(ctx)) return undefined;
  const raw = ctx.stepOutputs["revalidate-findings"];
  if (raw === undefined) return undefined;
  const investigation = recordInvestigationFindings.output(ctx);
  if (!investigation) {
    throw new Error("Security revalidation requires recorded investigation findings.");
  }
  return decodeSecurityRevalidationOutputForInvestigation(raw, investigation);
}

export const recordRevalidation = typedCodeStep<
  SecurityRevalidationOutput & { artifactPath: string }
>({
  id: "record-revalidation",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("revalidate-findings"),
  validate: (raw) =>
    expectStructuredOutput<
      SecurityRevalidationOutput & { artifactPath: string }
    >(raw, ["findings", "summary", "artifactPath"]),
  run: (ctx) => {
    const output = revalidationOutput(ctx) ?? {
      findings: [],
      summary: "No findings.",
    };
    const artifactPath = writeJsonArtifact(
      ctx.workflow.runDirPath,
      "security-review-revalidation.json",
      output,
    );
    return { ...output, artifactPath };
  },
});

/** Consumption and pending publication commit atomically only on successful review. */
export function finalizeSecurityReview(ctx: WorkflowFinalizationContext): void {
  const investigation = recordInvestigationFindings.output(ctx);
  if (!investigation) return;
  const runDirPath = join(ctx.stateDir, "runs", ctx.runId);
  const packet = scanCandidates.outputRequired(ctx);
  const revalidation = recordRevalidation.output(ctx);
  if (investigation.findings.length && !revalidation) throw new Error("Cannot consume findings without independent revalidation");
  const snapshot = ctx.state.read(SECURITY_REVIEW_STATE_KEY);
  const state = decodeSecurityReviewState(snapshot.value);
  const unresolved = new Set(revalidation?.findings.filter((finding) => finding.verdict === "follow-up-needed").map((finding) => finding.candidateId) ?? []);
  const reviewedPaths = investigation.coverage.filter((entry) => entry.disposition === "reviewed" &&
    !packet.candidates.some((candidate) => candidate.path === entry.path && unresolved.has(candidate.id))).map((entry) => entry.path);
  const input = refreshedReviewInputArtifact.read(runDirPath, refreshReviewInput.outputRequired(ctx));
  state.unreviewedSurfaces = { ...state.unreviewedSurfaces, ...input.previousSurfaces };
  for (const path of reviewedPaths) {
    state.reviewed[path] = {
      digest: packet.contentDigests[path]!,
      surfaces: [...new Set([
        ...state.reviewed[path]?.surfaces ?? [],
        ...state.unreviewedSurfaces[path] ?? [],
        ...packet.candidates.filter((candidate) => candidate.path === path).map((candidate) => candidate.surface),
      ])],
    };
    delete state.unreviewedSurfaces[path];
  }
  for (const finding of revalidation?.findings ?? []) {
    if (finding.verdict !== "confirmed" || resolveSecurityFindingTaskTarget(ctx.scopeRoot, finding).current) continue;
    if (!state.pending.some((entry) => securityFindingEvidenceKey(entry.finding) === securityFindingEvidenceKey(finding))) {
      state.pending.push({ runId: ctx.runId, finding: { ...finding, verdict: "confirmed" } });
    }
  }
  if (input.evidenceRequest) {
    const request = input.evidenceRequest;
    const reviewed = { ...input.evidenceReviewed };
    for (const path of reviewedPaths) {
      if (request.paths.includes(path)) reviewed[path] = packet.contentDigests[path]!;
    }
    state.evidenceRequests = state.evidenceRequests.filter((entry) => entry.request.id !== request.id);
    if (request.paths.every((path) => reviewed[path] !== undefined)) {
      state.reviewedEvidenceIds.push(request.id);
    } else {
      state.evidenceRequests.push({ request, reviewed });
    }
  }
  const nominations = new Map<string, string>();
  for (const entry of state.pending) {
    const key = securityFindingFamilyKey(entry.finding);
    const id = entry.finding.existingTaskId;
    if (id === null) continue;
    if (nominations.has(key) && nominations.get(key) !== id) throw new Error("Security family has conflicting existing task nominations");
    nominations.set(key, id);
  }
  for (const entry of state.pending) {
    entry.finding.existingTaskId = nominations.get(securityFindingFamilyKey(entry.finding)) ?? entry.finding.existingTaskId;
  }
  state.lastReview = { runId: ctx.runId, head: packet.head, completedAt: new Date().toISOString() };
  ctx.state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, state);
  writeJsonArtifact(runDirPath, "security-review-outcome.json", {
    outcome: state.pending.length ? "publication-pending" : "no-op", head: packet.head,
    coverage: investigation.coverage, reviewedPaths, pendingFindingCount: state.pending.length,
  });
}
