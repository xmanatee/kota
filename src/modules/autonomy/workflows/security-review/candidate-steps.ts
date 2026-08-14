import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowCommitPathPolicy } from "#modules/autonomy/commit.js";
import { onNormalTrigger } from "#modules/autonomy/recovery.js";
import {
  type SecurityReviewMutationBaseline,
  securityReviewCandidateScanOperation,
  securityReviewMutationBaselineOperation,
} from "./blocking-operations.js";
import {
  type SecurityReviewCandidate,
  type SecurityReviewCandidatePacket,
  writeSecurityReviewOutcome,
} from "./security-review.js";

type AgentCandidate = Omit<SecurityReviewCandidate, "excerpt">;
type AgentCandidatePacket = Pick<
  SecurityReviewCandidatePacket,
  "artifactPath" | "candidateCount" | "truncated"
> & { candidates: AgentCandidate[] };

export const captureMutationBaseline = typedCodeStep<SecurityReviewMutationBaseline>({
  id: "capture-mutation-baseline",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<SecurityReviewMutationBaseline>(raw, [
      "preExistingMutatedPaths",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(securityReviewMutationBaselineOperation, { projectDir }),
});

export function securityReviewCommitPolicy(
  ctx: WorkflowStepContext,
): WorkflowCommitPathPolicy {
  return {
    kind: "paths-mutated-since-baseline",
    baselineMutatedPaths:
      captureMutationBaseline.outputRequired(ctx).preExistingMutatedPaths,
  };
}

export const scanCandidates = typedCodeStep<AgentCandidatePacket>({
  id: "scan-candidates",
  type: "code",
  when: onNormalTrigger,
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<AgentCandidatePacket>(raw, [
      "candidates",
      "candidateCount",
      "artifactPath",
      "truncated",
    ]),
  run: async ({ projectDir, trigger, workflow, runBlocking }) => {
    const packet = await runBlocking(securityReviewCandidateScanOperation, {
      projectDir,
      runDirPath: workflow.runDirPath,
      trigger: { event: trigger.event, payload: trigger.payload },
    });
    return {
      candidates: packet.candidates.map(
        ({ id, surface, path, line, matcher }) => ({
          id,
          surface,
          path,
          line,
          matcher,
        }),
      ),
      candidateCount: packet.candidateCount,
      artifactPath: packet.artifactPath,
      truncated: packet.truncated,
    };
  },
});

export const recordEmptyScan = typedCodeStep<{
  written: true;
  artifactPath: string;
}>({
  id: "record-empty-scan",
  type: "code",
  when: (ctx) => scanCandidates.output(ctx)?.candidateCount === 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: true; artifactPath: string }>(raw, [
      "written",
      "artifactPath",
    ]),
  run: (ctx) =>
    writeSecurityReviewOutcome(ctx.workflow.runDirPath, {
      outcome: "no-op",
      reason: "empty-scan",
      candidateCount: 0,
    }),
});
