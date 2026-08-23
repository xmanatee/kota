import type { AgentDef } from "#core/agents/agent-types.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitCheckOperation,
  workflowCommitOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  inspectResearchRetryCandidatesOperation,
  markResearchRetryAttemptOperation,
} from "./blocking-operations.js";
import type { MarkAttemptResult } from "./precondition.js";
import {
  createResearchRetryShadowReviewStep,
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
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectResearchRetryCandidatesOperation, { projectDir }),
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
    return ctx.runBlocking(markResearchRetryAttemptOperation, {
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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
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
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(
                workflowCommitCheckOperation,
                { kind: "scratch-artifacts", projectDir: ctx.projectDir },
              ),
          },
          {
            id: "commit-message-exists",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(
                workflowCommitCheckOperation,
                {
                  kind: "commit-message",
                  projectDir: ctx.projectDir,
                  runDirPath: resolveAgentRunDirFromContext(ctx),
                },
              ),
          },
          {
            id: "commit-stageable",
            type: "code" as const,
            run: (ctx) =>
              withWorkflowBlockingOperation(ctx).runBlocking(
                workflowCommitCheckOperation,
                { kind: "commit-stageable", projectDir: ctx.projectDir },
              ),
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
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: resolveAgentRunDirFromContext(ctx),
        }),
    },
  ],
};

export default researchRetryWorkflow;
