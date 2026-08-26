import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  securityReviewCandidateScanOperation,
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

export const scanCandidates = typedCodeStep<AgentCandidatePacket>({
  id: "scan-candidates",
  type: "code",
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
