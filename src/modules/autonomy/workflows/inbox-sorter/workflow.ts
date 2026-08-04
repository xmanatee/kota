import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  createShadowSemanticReviewStep,
  type ExecutableShadowSemanticReviewerDeclaration,
  workflowMutationArtifacts,
} from "#modules/autonomy/shadow-semantic-review.js";
import type { ShadowSemanticReviewTargetResolution } from "#modules/autonomy/shadow-semantic-review-types.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { getRepoTaskQueueSnapshot, REPO_INBOX_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";

export const agent: AgentDef = {
  name: "inbox-sorter",
  role: "Turn quick inbox captures into the right durable project artifacts.",
  promptPath: "src/modules/autonomy/workflows/inbox-sorter/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: ["data/"],
};

type InboxSorterAssessment = {
  inboxCount: number;
  needsAttention: boolean;
};

const inspectInbox = typedCodeStep<InboxSorterAssessment>({
  id: "inspect-inbox",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<InboxSorterAssessment>(raw, ["inboxCount", "needsAttention"]),
  run: ({ projectDir }) => {
    const status = getRepoWorktreeStatus(projectDir);
    const nonInboxChanges = status.entries.filter(
      (entry) => !entry.includes(REPO_INBOX_DIR),
    );
    if (status.available && nonInboxChanges.length > 0) {
      throw new Error(
        `Repository has changes outside inbox: ${nonInboxChanges.join(", ")}`,
      );
    }
    const queue = getRepoTaskQueueSnapshot(projectDir);
    return {
      inboxCount: queue.inboxCount,
      needsAttention: queue.inboxCount > 0,
    };
  },
});

function resolveInboxSorterShadowTarget(
  ctx: Parameters<ExecutableShadowSemanticReviewerDeclaration["targetResolver"]>[0],
): ShadowSemanticReviewTargetResolution {
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
        ...workflowMutationArtifacts(ctx.workspaceDir ?? ctx.projectDir),
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "inbox-sorter" }),
    },
    inspectInbox,
    {
      id: "sort-inbox",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
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
            run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
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
        ],
      },
    },
    inboxSorterShadowReview,
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("sort-inbox"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
  ],
};

export default inboxSorterWorkflow;
