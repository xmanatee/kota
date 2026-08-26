import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { readAutonomyChangeDecisionArtifact } from "./autonomy-change-decision.js";
import {
  SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE,
  SHADOW_SEMANTIC_REVIEW_DIR,
  SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION,
  type ShadowSemanticReviewArtifact,
  type ShadowSemanticReviewerDeclaration,
} from "./shadow-semantic-review-types.js";

type ShadowSemanticReviewArtifactBody = Omit<
  ShadowSemanticReviewArtifact,
  | "schemaVersion"
  | "artifactType"
  | "runId"
  | "workflow"
  | "generatedAt"
  | "declarationId"
  | "reviewerProfileId"
  | "reviewerPromptHash"
  | "mode"
  | "targetKind"
  | "promotionCandidateRef"
  | "blockingDecisionArtifact"
>;

export function shadowSemanticReviewArtifactPath(
  runDirPath: string,
  declarationId: string,
): string {
  return join(runDirPath, SHADOW_SEMANTIC_REVIEW_DIR, `${declarationId}.json`);
}

export function shadowSemanticReviewPromptHash(
  declaration: ShadowSemanticReviewerDeclaration,
): string {
  return createHash("sha256")
    .update(declaration.reviewer.systemPrompt)
    .update("\n")
    .update(declaration.reviewer.question)
    .digest("hex")
    .slice(0, 12);
}

export function validateShadowSemanticReviewerDeclaration(
  workspaceRoot: string,
  declaration: ShadowSemanticReviewerDeclaration,
): void {
  if (!/^[a-z0-9-]+$/.test(declaration.id)) {
    throw new Error(`shadow reviewer declaration id must be kebab-case: ${declaration.id}`);
  }
  if (declaration.mode !== "blocking") return;
  if (!declaration.blockingDecisionArtifact) {
    throw new Error(
      `Blocking shadow reviewer "${declaration.id}" requires an autonomy-change-decision artifact`,
    );
  }
  const decisionPath = isAbsolute(declaration.blockingDecisionArtifact)
    ? declaration.blockingDecisionArtifact
    : join(workspaceRoot, declaration.blockingDecisionArtifact);
  const decision = readAutonomyChangeDecisionArtifact(decisionPath);
  if (decision.kind !== "valid") {
    throw new Error(
      `Blocking shadow reviewer "${declaration.id}" has no valid autonomy-change-decision artifact at ${declaration.blockingDecisionArtifact}`,
    );
  }
  if (
    decision.artifact.decision !== "promote" ||
    (decision.artifact.rolloutMode !== "blocking" &&
      decision.artifact.rolloutMode !== "promoted") ||
    !decision.artifact.changeClasses.includes("reviewer")
  ) {
    throw new Error(
      `Blocking shadow reviewer "${declaration.id}" requires a promoted reviewer autonomy-change decision`,
    );
  }
}

export function writeShadowSemanticReviewArtifact(
  ctx: WorkflowStepContext,
  declaration: ShadowSemanticReviewerDeclaration,
  body: ShadowSemanticReviewArtifactBody,
): { path: string; artifact: ShadowSemanticReviewArtifact } {
  const path = shadowSemanticReviewArtifactPath(ctx.workflow.runDirPath, declaration.id);
  const artifact = {
    schemaVersion: SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION,
    artifactType: SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE,
    runId: ctx.workflow.runId,
    workflow: ctx.workflow.name,
    generatedAt: new Date().toISOString(),
    declarationId: declaration.id,
    reviewerProfileId: declaration.reviewer.id,
    reviewerPromptHash: shadowSemanticReviewPromptHash(declaration),
    mode: declaration.mode,
    targetKind: declaration.targetKind,
    promotionCandidateRef: declaration.promotionCandidateRef,
    ...(declaration.blockingDecisionArtifact
      ? { blockingDecisionArtifact: declaration.blockingDecisionArtifact }
      : {}),
    ...body,
  } satisfies ShadowSemanticReviewArtifact;
  writeJsonFileAtomic(path, artifact);
  return { path, artifact };
}

export function shadowSemanticReviewShouldBlock(
  artifact: Pick<ShadowSemanticReviewArtifact, "mode" | "status" | "decision" | "findings">,
): boolean {
  if (artifact.mode !== "blocking") return false;
  if (artifact.status !== "reviewed") return artifact.status !== "skipped";
  return (
    artifact.decision === "fail" ||
    artifact.findings.some((finding) => finding.severity === "critical" && !finding.falsePositive)
  );
}
