import type { AgentDef } from "#core/agents/agent-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import { createImproverSemanticCheck } from "#modules/autonomy/improver-semantic-gate.js";
import { onRecoveryTrigger, resetWorktreeForRecovery } from "#modules/autonomy/recovery.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import { aggregateRunOutcomes } from "#modules/autonomy/run-outcome-aggregation.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import { writeRunSummary } from "#modules/autonomy/run-summary.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  decideImproverEvidenceGate,
  readImproverEvidenceGateState,
  shouldRunImproverFromGate,
  writeImproverEvidenceGateState,
} from "./evidence-gate.js";

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
    gatherRunDataStep,
    gateEvidenceStep,
    {
      id: "improve",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      harness: AUTONOMY_AGENT_HARNESS,
      when: (ctx) => shouldRunImproverFromGate(gateEvidenceStep.output(ctx)),
      model: agent.model,
      effort: agent.effort,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      repairLoop: {
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm build", ctx.projectDir),
          },
          {
            id: "workflow-validate",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("node dist/cli.js workflow validate", ctx.projectDir),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("pnpm run validate-tasks", ctx.projectDir),
          },
          {
            id: "typecheck",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("pnpm run typecheck", ctx.projectDir),
          },
          {
            id: "lint",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("pnpm run lint:fix && git add -u && pnpm run lint", ctx.projectDir),
          },
          {
            id: "test",
            type: "code" as const,
            phase: 1,
            run: (ctx) => runCheck("pnpm test", ctx.projectDir, 300_000),
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
      when: stepSucceeded("write-run-summary"),
      reason: "improver workflow finished validation and commit",
      requires: ["write-run-summary"],
    },
  ],
};

export default improverWorkflow;
