import type { AgentDef } from "#core/agents/agent-types.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { workflowCommandOutput } from "#core/workflow/workflow-command.js";
import {
  createShadowSemanticReviewStep,
  type ExecutableShadowSemanticReviewerDeclaration,
  shadowSemanticReviewTargetOperation,
} from "#modules/autonomy/shadow-semantic-review.js";
import type { ShadowSemanticReviewTargetResolution } from "#modules/autonomy/shadow-semantic-review-types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
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
  validate: (raw) =>
    expectStructuredOutput<InboxSorterAssessment>(raw, ["inboxCount", "needsAttention"]),
  run: ({ workspaceRoot, runBlocking }) =>
    runBlocking(inspectInboxSorterStateOperation, { workspaceRoot }),
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
      workspaceRoot: ctx.workspaceRoot,
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
    },
    targetResolver: resolveInboxSorterShadowTarget,
  },
});

const inboxSorterWorkflow: WorkflowDefinitionInput = {
  name: "inbox-sorter",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Process quick inbox captures into normalized tasks, docs, or other durable project artifacts.",
  tags: ["monitored"],
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: "autonomy.inbox.available", cooldownMs: 30_000 }],
  steps: [
    inspectInbox,
    {
      id: "sort-inbox",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => inspectInbox.outputRequired(ctx).needsAttention,
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: async (ctx) =>
              workflowCommandOutput(
                await ctx.runCommand({
                  command: "pnpm",
                  args: ["run", "validate-tasks"],
                  cwd: ctx.workspaceRoot,
                }),
              ),
          },
        ],
      },
    },
    inboxSorterShadowReview,
  ],
};

export default inboxSorterWorkflow;
