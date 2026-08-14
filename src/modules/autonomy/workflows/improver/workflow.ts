import type { AgentDef } from "#core/agents/agent-types.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { createImproverSemanticCheck } from "#modules/autonomy/improver-semantic-gate.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import { writeRunSummary } from "#modules/autonomy/run-summary.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_FULL_TEST_TIMEOUT_MS,
  runCheck,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitCheckOperation,
  workflowCommitOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  type ImproverWorktreeInspection,
  improverRepairCheckOperation,
  inspectImproverWorktreeOperation,
} from "./blocking-operations.js";
import {
  shouldRunImproverFromGate,
  writeImproverEvidenceGateState,
} from "./evidence-gate.js";
import {
  gateEvidenceStep,
  gatherHealthIssueCardsStep,
  gatherRunDataStep,
  gatherTaskGovernanceStep,
} from "./evidence-steps.js";

export const agent: AgentDef = {
  name: "improver",
  role: "Improve the autonomous development system itself using evidence from recent runs.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  // Improver tunes autonomy surfaces (prompts, validation, triggers, queue
  // shaping) that span the repo, so its scope is explicitly unrestricted.
  writeScope: [],
};

const inspectWorktree = typedCodeStep<ImproverWorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ImproverWorktreeInspection>(raw, ["dirty", "summary"]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectImproverWorktreeOperation, { projectDir }),
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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "improver",
        }),
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
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "scratch-artifacts",
                projectDir: ctx.projectDir,
              }),
          },
          {
            id: "doc-bloat",
            type: "code" as const,
            phase: 1,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(
                improverRepairCheckOperation,
                { kind: "doc-bloat", projectDir: ctx.projectDir },
              ),
          },
          {
            id: "repo-hygiene",
            type: "code" as const,
            phase: 1,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(
                improverRepairCheckOperation,
                { kind: "repo-hygiene", projectDir: ctx.projectDir },
              ),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "commit-message",
                projectDir: ctx.projectDir,
                runDirPath: ctx.workflow.runDirPath,
              }),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(workflowCommitCheckOperation, {
                kind: "commit-stageable",
                projectDir: ctx.projectDir,
              }),
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
      run: (ctx) =>
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: ctx.workflow.runDirPath,
        }),
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
