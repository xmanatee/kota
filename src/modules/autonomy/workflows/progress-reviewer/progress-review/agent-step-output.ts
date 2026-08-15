import { createHash } from "node:crypto";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowAgentStepOutputValidationContext } from "#core/workflow/step-input-base.js";
import {
  type CodeStepOutputValidator,
  expectStructuredOutput,
} from "#core/workflow/step-input-code.js";
import { decodeProgressReviewAgentOutputForEvidence } from "./agent-output.js";
import { PROGRESS_REVIEW_EVIDENCE_ARTIFACT } from "./constants.js";
import type {
  ProgressReviewAgentEvidencePacket,
  ProgressReviewAgentOutput,
  ProgressReviewEvidencePacket,
} from "./types.js";

export type ProgressReviewEvidenceHandle = {
  generatedAt: string;
  artifact: typeof PROGRESS_REVIEW_EVIDENCE_ARTIFACT;
  artifactPath: string;
  contentSha256: string;
};

export function digestProgressReviewEvidencePacket(
  packet: ProgressReviewEvidencePacket,
): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

export const validateProgressReviewEvidencePacket: CodeStepOutputValidator<
  ProgressReviewEvidencePacket
> = (raw) =>
  expectStructuredOutput<ProgressReviewEvidencePacket>(raw, [
    "generatedAt",
    "triggerKind",
    "triggerEvent",
    "scope",
    "window",
    "scopes",
    "evidence",
    "approvals",
    "excluded",
    "taskClassDistribution",
    "operatorJourneyRisks",
  ]);

export const validateProgressReviewEvidenceHandle: CodeStepOutputValidator<
  ProgressReviewEvidenceHandle
> = (raw) => {
  const handle = expectStructuredOutput<ProgressReviewEvidenceHandle>(raw, [
    "generatedAt",
    "artifact",
    "artifactPath",
    "contentSha256",
  ]);
  if (handle.artifact !== PROGRESS_REVIEW_EVIDENCE_ARTIFACT) {
    throw new Error(
      `unexpected progress-review evidence artifact ${String(handle.artifact)}`,
    );
  }
  if (typeof handle.generatedAt !== "string" || !handle.generatedAt.trim()) {
    throw new Error("progress-review evidence generatedAt must be non-empty");
  }
  if (typeof handle.artifactPath !== "string" || !handle.artifactPath.trim()) {
    throw new Error("progress-review evidence artifactPath must be non-empty");
  }
  if (
    typeof handle.contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(handle.contentSha256)
  ) {
    throw new Error(
      "progress-review evidence contentSha256 must be a lowercase SHA-256 digest",
    );
  }
  return handle;
};

export const validateProgressReviewAgentEvidencePacket: CodeStepOutputValidator<
  ProgressReviewAgentEvidencePacket
> = (raw) =>
  expectStructuredOutput<ProgressReviewAgentEvidencePacket>(raw, [
    "generatedAt",
    "triggerKind",
    "triggerEvent",
    "scope",
    "window",
    "batch",
    "scopes",
    "counts",
    "deadLetterCounts",
    "operatorJourneyRisks",
    "evidence",
    "excluded",
  ]);

export function readProgressReviewEvidencePacketFromHandle(
  handle: ProgressReviewEvidenceHandle,
): ProgressReviewEvidencePacket {
  const raw = readOptionalJsonFile<
    Parameters<typeof validateProgressReviewEvidencePacket>[0]
  >(handle.artifactPath);
  if (raw === null) {
    throw new Error(
      `progress-review evidence artifact is missing: ${handle.artifactPath}`,
    );
  }
  const packet = validateProgressReviewEvidencePacket(raw);
  const actualSha256 = digestProgressReviewEvidencePacket(packet);
  if (actualSha256 !== handle.contentSha256) {
    throw new Error(
      `progress-review evidence artifact digest mismatch: ${handle.artifactPath}`,
    );
  }
  return packet;
}

export function validateProgressReviewAgentStepOutput(
  raw: Parameters<typeof decodeProgressReviewAgentOutputForEvidence>[0],
  context: WorkflowAgentStepOutputValidationContext,
): ProgressReviewAgentOutput {
  const evidence = readProgressReviewEvidencePacketFromHandle(
    validateProgressReviewEvidenceHandle(
      context.stepOutputs["collect-evidence"],
    ),
  );
  const reviewInput = validateProgressReviewAgentEvidencePacket(
    context.stepOutputs["prepare-review-input"],
  );
  return decodeProgressReviewAgentOutputForEvidence(raw, reviewInput, evidence);
}
