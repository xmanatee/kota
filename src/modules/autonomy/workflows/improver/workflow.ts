import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import {
  type AutonomyHealthIssueEvidence,
  collectRecentAutonomyHealthIssueCards,
} from "#modules/autonomy/health-issue-cards.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { createImproverSemanticCheck } from "#modules/autonomy/improver-semantic-gate.js";
import { onRecoveryTrigger, resetWorktreeForRecovery } from "#modules/autonomy/recovery.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import { aggregateRunOutcomes } from "#modules/autonomy/run-outcome-aggregation.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import { writeRunSummary } from "#modules/autonomy/run-summary.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_FULL_TEST_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  decideImproverEvidenceGate,
  readImproverEvidenceGateState,
  shouldRunImproverFromGate,
  writeImproverEvidenceGateState,
} from "./evidence-gate.js";
import {
  collectImproverTaskGovernance,
  type ImproverTaskGovernanceEvidence,
} from "./task-governance.js";

type WorktreeInspection = {
  dirty: boolean;
  summary: string;
};

export const agent: AgentDef = {
  name: "improver",
  role: "Improve the autonomous development system itself using evidence from recent runs.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // Improver tunes autonomy surfaces (prompts, validation, triggers, queue
  // shaping) that span the repo, so its scope is explicitly unrestricted.
  writeScope: [],
};

const gatherRunDataStep = typedCodeStep<RunOutcomeAggregation>({
  id: "gather-run-data",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<RunOutcomeAggregation>(raw, [
      "failureRates24h",
      "failureRates7d",
      "topRepairFailures24h",
      "topRepairFailures7d",
      "durationOutliers",
      "agentStepTimeouts7d",
      "latestActionableRunAt",
    ]),
  run: ({ projectDir }) => {
    const store = new WorkflowRunStore(projectDir);
    return aggregateRunOutcomes(store.runsDir);
  },
});

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<WorktreeInspection>(raw, ["dirty", "summary"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return {
      dirty: worktree.available && worktree.dirty,
      summary: worktree.summary,
    };
  },
});

const gatherHealthIssueCardsStep = typedCodeStep<AutonomyHealthIssueEvidence>({
  id: "gather-health-issue-cards",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<AutonomyHealthIssueEvidence>(raw, [
      "generatedAt",
      "latestHealthReviewAt",
      "issueCards",
    ]),
  run: ({ projectDir }) => collectRecentAutonomyHealthIssueCards(projectDir),
});

const gatherTaskGovernanceStep = typedCodeStep<ImproverTaskGovernanceEvidence>({
  id: "gather-task-governance",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<ImproverTaskGovernanceEvidence>(raw, [
      "generatedAt",
      "openByTaskClass",
      "actionableMetaWithoutProductSafetyLink",
      "productDoneWithoutOperatorEvidence",
    ]),
  run: ({ projectDir }) => collectImproverTaskGovernance(projectDir),
});

const gateEvidenceStep = typedCodeStep<ReturnType<typeof decideImproverEvidenceGate>>({
  id: "gate-evidence",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ReturnType<typeof decideImproverEvidenceGate>>(raw, [
      "shouldRun",
      "reason",
    ]),
  run: (ctx) =>
    decideImproverEvidenceGate(
      gatherRunDataStep.outputRequired(ctx),
      readImproverEvidenceGateState(ctx.projectDir),
      gatherHealthIssueCardsStep.outputRequired(ctx),
    ),
});

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description:
    "Improve the autonomous development system itself using evidence from recent runs.",
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    // Any monitored workflow completion is a signal that aggregate run data
    // may have shifted — improver reads 24h/7d aggregates, not one specific
    // run, so it's entity-agnostic by design. Self-trigger-safe: improver
    // does not carry the "monitored" tag.
    {
      event: "workflow.completed",
      filter: { tags: ["monitored"] },
    },
    // Distinct trigger class: recovery re-entry after a daemon crash.
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "clean-recovery-state",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "improver" }),
    },
    inspectWorktree,
    gatherRunDataStep,
    gatherHealthIssueCardsStep,
    gatherTaskGovernanceStep,
    gateEvidenceStep,
    {
      id: "improve",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      when: (ctx) =>
        shouldRunImproverFromGate(gateEvidenceStep.output(ctx)) &&
        inspectWorktree.output(ctx)?.dirty === false,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      repairLoop: {
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm build", ctx.projectDir, { signal: ctx.signal }),
          },
          {
            id: "workflow-validate",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck(
              "pnpm dev workflow validate",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck(
              "pnpm run validate-tasks",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "typecheck",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck(
              "pnpm run typecheck",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "lint",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck(
              "pnpm run lint",
              ctx.projectDir,
              { signal: ctx.signal },
            ),
          },
          {
            id: "test",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("pnpm test", ctx.projectDir, {
              timeoutMs: AUTONOMY_FULL_TEST_TIMEOUT_MS,
              signal: ctx.signal,
            }),
          },
          {
            id: "no-scratch-artifacts",
            type: "code" as const,
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
          },
          {
            id: "doc-bloat",
            type: "code" as const,
            phase: 1,
            run: (ctx) => checkDocBloat(ctx.projectDir),
          },
          {
            id: "repo-hygiene",
            type: "code" as const,
            phase: 1,
            run: (ctx) => checkRepoHygiene(ctx.projectDir),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) => checkCommitStageable(ctx.projectDir),
          },
          { ...createImproverSemanticCheck(), phase: 2 },
        ],
      },
    },
    {
      id: "record-evidence-fingerprint",
      type: "code",
      when: stepSucceeded("improve"),
      run: (ctx) =>
        writeImproverEvidenceGateState(
          ctx.projectDir,
          gateEvidenceStep.outputRequired(ctx),
        ),
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("record-evidence-fingerprint"),
      run: ({ projectDir, workflow }) =>
        commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    typedCodeStep<WorkflowRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      validate: (raw) =>
        expectStructuredOutput<WorkflowRunSummary>(raw, [
          "runId",
          "workflow",
          "outcome",
          "commitSha",
          "commitMessage",
          "filesChanged",
        ]),
      run: (ctx) => writeRunSummary(ctx, "improve"),
    }),
    {
      id: "request-restart",
      type: "restart",
      when: (ctx) =>
        stepSucceeded("write-run-summary")(ctx) &&
        stepCommitRequiresDaemonRestart("commit")(ctx),
      reason: "improver workflow finished validation and commit",
      requires: ["write-run-summary"],
    },
  ],
};

export default improverWorkflow;
