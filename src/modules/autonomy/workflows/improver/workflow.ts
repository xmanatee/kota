import type { AgentDef } from "#core/agents/agent-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { createImproverSemanticCheck } from "#modules/autonomy/improver-semantic-gate.js";
import { onRecoveryTrigger, resetWorktreeForRecovery } from "#modules/autonomy/recovery.js";
import { aggregateRunOutcomes } from "#modules/autonomy/run-outcome-aggregation.js";
import type { RunOutcomeAggregation } from "#modules/autonomy/run-outcome-aggregation.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import { writeRunSummary } from "#modules/autonomy/run-summary.js";
import { AUTONOMY_DISALLOWED_TOOLS, checkCommitMessageExists, checkNoScratchArtifacts, runCheck, stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";
import {
  decideImproverEvidenceGate,
  readImproverEvidenceGateState,
  shouldRunImproverFromGate,
  writeImproverEvidenceGateState,
} from "./evidence-gate.js";

// Measured improver cadence (~60-90m between runs on recent history) is
// already bounded by this cooldown rather than trigger firing rate, so keep
// 60m as the single pacing constant across triggers.
export const IMPROVER_COOLDOWN_MS = 60 * 60 * 1000;

export const agent: AgentDef = {
  name: "improver",
  role: "Improve the autonomous development system itself using evidence from recent runs.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  model: "claude-opus-4-7",
  effort: "xhigh",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

const gatherRunDataStep = typedCodeStep<RunOutcomeAggregation>({
  id: "gather-run-data",
  type: "code",
  exposeOutputToAgent: true,
  run: ({ projectDir }) => {
    const store = new WorkflowRunStore(projectDir);
    return aggregateRunOutcomes(store.runsDir);
  },
});

const gateEvidenceStep = typedCodeStep<ReturnType<typeof decideImproverEvidenceGate>>({
  id: "gate-evidence",
  type: "code",
  run: (ctx) =>
    decideImproverEvidenceGate(
      gatherRunDataStep.output(ctx),
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
      cooldownMs: IMPROVER_COOLDOWN_MS,
    },
    // Distinct trigger class: recovery re-entry after a daemon crash.
    {
      event: "runtime.recovered",
      cooldownMs: IMPROVER_COOLDOWN_MS,
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
      when: (ctx) => shouldRunImproverFromGate(gateEvidenceStep.output(ctx)),
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      // Improver analysis at xhigh effort legitimately runs long; observed
      // successful outliers reach ~35 min. 45 min gives headroom above the
      // 30-min global default so real work isn't clipped at the cliff.
      timeoutMs: 45 * 60 * 1000,
      repairLoop: {
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm build", ctx.projectDir),
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
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
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
          gateEvidenceStep.output(ctx),
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
