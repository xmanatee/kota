import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { listResearchRetryCandidates, type ResearchRetryCandidate } from "./candidates.js";
import {
  checkResearchRetryCapability,
  evaluateCandidate,
  type MarkAttemptResult,
  writeMarkerForCandidate,
} from "./precondition.js";
import {
  type CandidateSummary,
  createResearchRetryShadowReviewStep,
  type ExaminedCandidate,
  type InspectResult,
} from "./shadow-review.js";

export const agent: AgentDef = {
  name: "research-retry",
  role:
    "Retry one blocked research task's inaccessible sources using authenticated-browser and rendered-browser tools, then update task state honestly.",
  promptPath: "src/modules/autonomy/workflows/research-retry/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: "all",
  writeScope: ["data/tasks/", "data/inbox/"],
};

function summarizeCandidate(candidate: ResearchRetryCandidate): CandidateSummary {
  return {
    id: candidate.id,
    updatedAt: candidate.updatedAt,
    urls: candidate.urls,
  };
}

const inspectCandidates = typedCodeStep<InspectResult>({
  id: "inspect-candidates",
  type: "code",
  when: onNormalTrigger,
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<InspectResult>(raw, [
      "dirty",
      "candidateCount",
      "capability",
      "candidate",
      "fingerprint",
      "marker",
      "examined",
    ]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.dirty;
    const capability = checkResearchRetryCapability(projectDir);
    const candidates = listResearchRetryCandidates(projectDir);

    const examined: ExaminedCandidate[] = [];
    for (const candidate of candidates) {
      const evaluation = evaluateCandidate({
        urls: candidate.urls,
        body: candidate.body,
        capability,
      });
      if (evaluation.skipReason === null) {
        return {
          dirty,
          candidateCount: candidates.length,
          capability,
          candidate: summarizeCandidate(candidate),
          fingerprint: evaluation.fingerprint,
          marker: evaluation.marker,
          examined,
        };
      }
      examined.push({
        id: candidate.id,
        fingerprint: evaluation.fingerprint,
        marker: evaluation.marker,
        skipReason: evaluation.skipReason,
      });
    }

    return {
      dirty,
      candidateCount: candidates.length,
      capability,
      candidate: null,
      fingerprint: null,
      marker: null,
      examined,
    };
  },
});

const markAttempt = typedCodeStep<MarkAttemptResult>({
  id: "mark-attempt",
  type: "code",
  when: stepSucceeded("retry"),
  validate: (raw): MarkAttemptResult => {
    const obj = expectStructuredOutput<{ written: boolean }>(raw, ["written"]);
    if (typeof obj.written !== "boolean") {
      throw new Error(`expected written: boolean, got ${typeof obj.written}`);
    }
    return raw as MarkAttemptResult;
  },
  run: (ctx) => {
    const inspection = inspectCandidates.outputRequired(ctx);
    if (!inspection.candidate) {
      return { written: false, reason: "no candidate selected" };
    }
    return writeMarkerForCandidate({
      projectDir: ctx.projectDir,
      candidateId: inspection.candidate.id,
    });
  },
});

const researchRetryShadowReview = createResearchRetryShadowReviewStep({
  inspectCandidates,
  markAttempt,
});

const researchRetryWorkflow: WorkflowDefinitionInput = {
  name: "research-retry",
  description:
    "Re-attempt inaccessible sources in blocked research tasks using the browser module's authenticated / rendered tools, then update task state honestly.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.blocked-research.attemptable",
      cooldownMs: 60_000,
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "research-retry",
          restoreBaseBranch: true,
        }),
    },
    inspectCandidates,
    {
      id: "retry",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        const inspection = inspectCandidates.outputRequired(ctx);
        return !inspection.dirty && inspection.candidate !== null;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck(
              "pnpm run validate-tasks",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) =>
              checkCommitMessageExists(
                resolveAgentRunDirFromContext(ctx),
                ctx.projectDir,
              ),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) => checkCommitStageable(ctx.projectDir),
          },
        ],
      },
    },
    markAttempt,
    researchRetryShadowReview,
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("retry"),
      run: (ctx) =>
        commitWorkflowChanges(
          ctx.projectDir,
          resolveAgentRunDirFromContext(ctx),
        ),
    },
  ],
};

export default researchRetryWorkflow;
