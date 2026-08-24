import type {
  WorkflowRepairContinuationDecision,
  WorkflowRepairContinuationInput,
  WorkflowRepairContinuationPacket,
} from "#core/workflow/run-types.js";

export const BUILDER_CONTINUATION_ARTIFACT = "builder-continuation.json";

export type BuilderContinuationArtifact = {
  schemaVersion: 1;
  runId: string;
  latestPacket: WorkflowRepairContinuationPacket;
  decisions: WorkflowRepairContinuationDecision[];
};

export type BuilderContinuationInspectionInput = {
  projectDir: string;
  workspaceDir: string;
  runDir: string;
  agentRunDir: string;
  runId: string;
  taskId: string;
  priorRunIds: string[];
  continuation: WorkflowRepairContinuationInput;
};

export type BuilderContinuationInspection = {
  packet: WorkflowRepairContinuationPacket | null;
  taskContract: string;
  diffContent: string;
  artifactPath: string;
};

export type BuilderContinuationJudgeDecision = Pick<
  WorkflowRepairContinuationDecision,
  "decision" | "summary" | "nextAction"
> & {
  evidence: string[];
};

export function parseBuilderContinuationJudgeDecision(
  text: string,
): BuilderContinuationJudgeDecision {
  const parsed = JSON.parse(text) as BuilderContinuationJudgeDecision;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    ![
      "continue",
      "decompose",
      "preserve-yield",
      "needs-owner",
    ].includes(parsed.decision) ||
    typeof parsed.summary !== "string" ||
    parsed.summary.trim().length === 0 ||
    typeof parsed.nextAction !== "string" ||
    parsed.nextAction.trim().length === 0 ||
    !Array.isArray(parsed.evidence) ||
    parsed.evidence.length === 0 ||
    parsed.evidence.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new Error("Builder continuation judge returned an invalid decision");
  }
  return parsed;
}
