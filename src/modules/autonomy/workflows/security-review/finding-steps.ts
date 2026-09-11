import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { refreshReviewInput, scanCandidates } from "./candidate-steps.js";
import { finalizeSecurityReviewRefusal } from "./refusal-steps.js";
import { type ReviewInputReference, refreshedReviewInputArtifact, reviewInputReferenceSchema, securityReviewArtifact } from "./review-input-artifact.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY, securityReviewPathUnavailable, validateSecurityReviewState } from "./review-state.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  writeJsonArtifact,
} from "./security-review.js";
import { decodeSecurityRevalidationOutput } from "./security-review-output.js";
import { resolvePendingSecurityFindings, resolveSecurityFindingTaskTarget, securityFindingFamilyKey } from "./security-review-task-identity.js";

export const investigationArtifact = securityReviewArtifact("security-review-investigation.json", decodeSecurityInvestigationOutput);
export const revalidationArtifact = securityReviewArtifact("security-review-revalidation.json", decodeSecurityRevalidationOutput);

export function recordedInvestigation(ctx: WorkflowStepContext): SecurityInvestigationOutput | undefined {
  const reference = recordInvestigationFindings.output(ctx);
  return reference && investigationArtifact.read(ctx.workflow.runDirPath, reference);
}

function investigationOutput(
  ctx: WorkflowStepContext,
): SecurityInvestigationOutput | undefined {
  if (!stepSucceeded("investigate-candidates")(ctx)) return undefined;
  const raw = ctx.stepOutputs["investigate-candidates"];
  return raw === undefined ? undefined : decodeSecurityInvestigationOutput(raw);
}

export const recordInvestigationFindings = typedCodeStep<ReviewInputReference>({
  id: "record-investigation-findings",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("investigate-candidates"),
  validate: (raw) => reviewInputReferenceSchema.parse(raw),
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
    return investigationArtifact.write(ctx.workflow.runDirPath, output);
  },
});

function revalidationOutput(
  ctx: WorkflowStepContext,
): SecurityRevalidationOutput | undefined {
  if (!stepSucceeded("revalidate-findings")(ctx)) return undefined;
  const raw = ctx.stepOutputs["revalidate-findings"];
  if (raw === undefined) return undefined;
  const investigation = recordedInvestigation(ctx);
  if (!investigation) {
    throw new Error("Security revalidation requires recorded investigation findings.");
  }
  return decodeSecurityRevalidationOutputForInvestigation(raw, investigation);
}

export const recordRevalidation = typedCodeStep<ReviewInputReference>({
  id: "record-revalidation",
  type: "code",
  exposeOutputToAgent: true,
  when: stepSucceeded("revalidate-findings"),
  validate: (raw) => reviewInputReferenceSchema.parse(raw),
  run: (ctx) => {
    const output = revalidationOutput(ctx) ?? {
      findings: [],
      summary: "No findings.",
    };
    return revalidationArtifact.write(ctx.workflow.runDirPath, output);
  },
});

/** Consumption and pending publication commit atomically only on successful review. */
export function finalizeSecurityReview(ctx: WorkflowFinalizationContext): void {
  if (finalizeSecurityReviewRefusal(ctx)) return;
  const reference = recordInvestigationFindings.output(ctx);
  if (!reference) return;
  const runDirPath = join(ctx.stateDir, "runs", ctx.runId);
  const investigation = investigationArtifact.read(runDirPath, reference);
  const packet = scanCandidates.outputRequired(ctx);
  const revalidationReference = recordRevalidation.output(ctx);
  const revalidation = revalidationReference && revalidationArtifact.read(runDirPath, revalidationReference);
  if (revalidation) {
    const expected = decodeSecurityRevalidationOutputForInvestigation({ findings: revalidation.findings.map(({ id, verdict, rationale }) => ({ id, verdict, rationale })), summary: revalidation.summary }, investigation);
    if (!isDeepStrictEqual(expected, revalidation)) throw new Error("Security revalidation differs from its investigation");
  }
  if (investigation.findings.length && !revalidation) throw new Error("Cannot consume findings without independent revalidation");
  const snapshot = ctx.state.read(SECURITY_REVIEW_STATE_KEY);
  const state = decodeSecurityReviewState(snapshot.value);
  const unresolved = new Set(revalidation?.findings.filter((finding) => finding.verdict === "follow-up-needed").map((finding) => finding.candidateId) ?? []);
  const reviewedPaths = investigation.coverage.filter((entry) => entry.disposition === "reviewed" &&
    !packet.candidates.some((candidate) => candidate.path === entry.path && unresolved.has(candidate.id))).map((entry) => entry.path);
  const input = refreshedReviewInputArtifact.read(runDirPath, refreshReviewInput.outputRequired(ctx));
  const selectedPaths = [...new Set(packet.candidates.map((candidate) => candidate.path))];
  const revisitedUnavailablePaths = selectedPaths.filter((path) => state.unavailable[path]?.digest === packet.contentDigests[path]);
  const deferredUnavailablePaths = Object.keys(state.unavailable).filter((path) => securityReviewPathUnavailable(state, path, input.contentDigests, input.evidenceRequest?.paths.includes(path) ? input.evidenceRequest.id : null));
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
    delete state.unavailable[path];
  }
  for (const coverage of investigation.coverage) {
    if (coverage.disposition !== "unavailable") {
      delete state.unavailable[coverage.path];
      continue;
    }
    if (packet.candidates.some((candidate) => candidate.path === coverage.path && unresolved.has(candidate.id))) continue;
    state.unavailable[coverage.path] = {
      requestIds: [...new Set([
        ...securityReviewPathUnavailable(state, coverage.path, input.contentDigests, null) ? state.unavailable[coverage.path]!.requestIds : [],
        ...input.evidenceRequest?.paths.includes(coverage.path) ? [input.evidenceRequest.id] : [],
      ])], digest: packet.contentDigests[coverage.path]!, runId: ctx.runId, rationale: coverage.rationale,
      prerequisites: Object.fromEntries(coverage.prerequisitePaths.map((path) => [path, input.contentDigests[path] ?? "deleted"])),
    };
  }
  const confirmed = (revalidation?.findings ?? []).filter((finding) => finding.verdict === "confirmed");
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
  const incoming = confirmed.map((finding) => ({ runId: ctx.runId, finding: { ...finding, verdict: "confirmed" as const } }));
  const retained = resolvePendingSecurityFindings(ctx.scopeRoot, state.pending);
  const nominations = new Map<string, string>();
  // Fresh nominations are checked together. Historical ambiguity cannot reject
  // an unrelated review or nominate a stale task on its behalf.
  for (const entry of incoming) {
    const key = securityFindingFamilyKey(entry.finding);
    const id = entry.finding.existingTaskId;
    if (id === null) continue;
    if (nominations.has(key) && nominations.get(key) !== id) throw new Error("Security family has conflicting existing task nominations");
    nominations.set(key, id);
  }
  for (const entry of incoming) {
    const key = securityFindingFamilyKey(entry.finding);
    const historical = new Set(retained.resolved.filter(({ entry: pending }) => pending.finding.existingTaskId !== null && securityFindingFamilyKey(pending.finding) === key).map(({ target }) => target.id));
    if (!nominations.has(key) && historical.size > 1) throw new Error("Security family requires a revalidated canonical task nomination");
    entry.finding.existingTaskId = nominations.get(key) ?? (historical.size === 1 ? [...historical][0]! : entry.finding.existingTaskId);
    if (entry.finding.existingTaskId !== null) nominations.set(key, entry.finding.existingTaskId);
  }
  const parkedFindings = [...retained.parked];
  const parkedEntries = new Set<(typeof state.pending)[number]>();
  for (const retainedFinding of retained.resolved) {
    const { entry } = retainedFinding;
    const nominated = nominations.get(securityFindingFamilyKey(entry.finding));
    if (entry.finding.existingTaskId !== null || nominated === undefined) continue;
    const finding = { ...entry.finding, existingTaskId: nominated };
    try {
      retainedFinding.target = resolveSecurityFindingTaskTarget(ctx.scopeRoot, finding);
      entry.finding = finding;
    } catch (error) {
      parkedFindings.push({ runId: entry.runId, findingId: finding.id, reason: String(error) });
      parkedEntries.add(entry);
    }
  }
  const lineageReconciliations: { pendingRunId: string; pendingFindingId: string; revalidationRunId: string; evidenceKey: string }[] = [];
  for (const entry of incoming) {
    const target = resolveSecurityFindingTaskTarget(ctx.scopeRoot, entry.finding);
    const matching = [...retained.resolved, ...retained.lineageRequired].filter(({ entry: pending, target: pendingTarget }) => !parkedEntries.has(pending) && pendingTarget.evidenceKey === target.evidenceKey).map(({ entry: pending }) => pending);
    // Revalidation repairs the retained outbox before replay suppression. Keep
    // its original evidence and run provenance for the task publication owner.
    for (const pending of matching) {
      if (pending.finding.evidenceLineage !== null || entry.finding.evidenceLineage === null) continue;
      const finding = { ...pending.finding, existingTaskId: target.id, evidenceLineage: entry.finding.evidenceLineage };
      try {
        resolveSecurityFindingTaskTarget(ctx.scopeRoot, finding);
      } catch (error) {
        parkedFindings.push({ runId: pending.runId, findingId: finding.id, reason: String(error) });
        parkedEntries.add(pending);
        continue;
      }
      pending.finding = finding;
      for (let index = parkedFindings.length - 1; index >= 0; index -= 1) {
        if (parkedFindings[index]!.runId === pending.runId && parkedFindings[index]!.findingId === finding.id) parkedFindings.splice(index, 1);
      }
      lineageReconciliations.push({ pendingRunId: pending.runId, pendingFindingId: finding.id, revalidationRunId: entry.runId, evidenceKey: target.evidenceKey });
    }
    if (target.current) continue;
    if (!matching.some((pending) => !parkedEntries.has(pending))) {
      state.pending.push(entry);
      retained.resolved.push({ entry, target });
    }
  }
  state.lastReview = { runId: ctx.runId, head: packet.head, completedAt: new Date().toISOString() };
  ctx.state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, validateSecurityReviewState(state));
  writeJsonArtifact(runDirPath, "security-review-outcome.json", {
    outcome: state.pending.length ? "publication-pending" : "no-op", head: packet.head,
    coverage: investigation.coverage, selectedPaths, revisitedUnavailablePaths, deferredUnavailablePaths, reviewedPaths, pendingFindingCount: state.pending.length, lineageReconciliations, parkedFindings,
  });
}
