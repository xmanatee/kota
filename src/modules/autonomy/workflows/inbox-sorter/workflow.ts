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
  createShadowSemanticReviewStep,
  type ExecutableShadowSemanticReviewerDeclaration,
  shadowSemanticReviewTargetOperation,
} from "#modules/autonomy/shadow-semantic-review.js";
import type { ShadowSemanticReviewTargetResolution } from "#modules/autonomy/shadow-semantic-review-types.js";
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
  type InboxSorterAssessment,
  inspectInboxSorterStateOperation,
} from "./inspect-inbox.js";

export const agent: AgentDef = {
  name: "inbox-sorter",
  role: "Turn quick inbox captures into the right durable project artifacts.",
  promptPath: "src/modules/autonomy/workflows/inbox-sorter/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: ["data/"],
};

const inspectInbox = typedCodeStep<InboxSorterAssessment>({
  id: "inspect-inbox",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<InboxSorterAssessment>(raw, ["inboxCount", "needsAttention"]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectInboxSorterStateOperation, { projectDir }),
});

async function resolveInboxSorterShadowTarget(
  ctx: Parameters<ExecutableShadowSemanticReviewerDeclaration["targetResolver"]>[0],
): Promise<ShadowSemanticReviewTargetResolution> {
  const inspection = inspectInbox.output(ctx);
  if (!inspection?.needsAttention) {
    return {
      kind: "skip",
      reason: "Inbox sorter had no target: inbox was empty or inspection was skipped.",
      citedArtifacts: ["metadata:inspect-inbox"],
    };
  }
  if (!stepSucceeded("sort-inbox")(ctx)) {
    return {
      kind: "skip",
      reason: "Inbox sorter target unavailable because the sort-inbox step did not succeed.",
      citedArtifacts: ["metadata:sort-inbox"],
    };
  }
  const mutationArtifacts = await withWorkflowBlockingOperation(ctx).runBlocking(
    shadowSemanticReviewTargetOperation,
    {
      kind: "workflow-mutations",
      projectDir: ctx.workspaceDir ?? ctx.projectDir,
    },
  );
  return {
    kind: "target",
    target: {
      id: `${ctx.workflow.runId}:inbox-sorter`,
      kind: "task-queue",
      summary:
        "Review inbox sorting output for intent preservation, duplicate avoidance, task-format compliance, and queue classification quality.",
      artifacts: [
        {
          path: "metadata:inspect-inbox",
          content: JSON.stringify(inspection, null, 2),
        },
        ...mutationArtifacts,
      ],
    },
  };
}

const inboxSorterShadowReview = createShadowSemanticReviewStep({
  id: "shadow-semantic-review",
  when: onNormalTrigger,
  declaration: {
    id: "inbox-sorter-queue-triage",
    mode: "advisory",
    targetKind: "task-queue",
    promotionCandidateRef:
      "task-run-shadow-semantic-reviewers-for-non-builder-auto#inbox-sorter",
    reviewer: {
      id: "queue-triage-shadow-reviewer-v1",
      systemPrompt:
        "You are an advisory semantic reviewer for KOTA inbox and queue triage. Judge only the declared artifacts. Do not inspect hidden reasoning, unrelated files, broad run logs, or conversation state.",
      question:
        "Does this inbox-sorter output preserve source intent, avoid duplicate or speculative tasks, respect data/task AGENTS instructions, and leave queue state honest?",
      maxTurns: 6,
    },
    targetResolver: resolveInboxSorterShadowTarget,
  },
});

const inboxSorterWorkflow: WorkflowDefinitionInput = {
  name: "inbox-sorter",
  description:
    "Process quick inbox captures into normalized tasks, docs, or other durable project artifacts.",
  tags: ["monitored"],
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    {
      event: "autonomy.inbox.available",
      cooldownMs: 30_000,
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
          workflowName: "inbox-sorter",
        }),
    },
    inspectInbox,
    {
      id: "sort-inbox",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        return inspectInbox.outputRequired(ctx).needsAttention;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck(
              "pnpm run validate-tasks -- --min-ready 0",
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
    inboxSorterShadowReview,
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("sort-inbox"),
      run: (ctx) =>
        ctx.runBlocking(workflowCommitOperation, {
          projectDir: ctx.projectDir,
          runDirPath: resolveAgentRunDirFromContext(ctx),
        }),
    },
  ],
};

export default inboxSorterWorkflow;
