import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoTaskQueueSnapshot, REPO_INBOX_DIR } from "#core/data/repo-tasks.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { AUTONOMY_DISALLOWED_TOOLS, checkCommitMessageExists, checkNoScratchArtifacts, runCheck, stepSucceeded } from "#modules/autonomy/shared.js";

export const agent: AgentDef = {
  name: "inbox-sorter",
  role: "Turn quick inbox captures into the right durable project artifacts.",
  promptPath: "src/modules/autonomy/workflows/inbox-sorter/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

type InboxSorterAssessment = {
  inboxCount: number;
  needsAttention: boolean;
};

const inspectInbox = typedCodeStep<InboxSorterAssessment>({
  id: "inspect-inbox",
  type: "code",
  run: ({ projectDir }) => {
    const status = getRepoWorktreeStatus(projectDir);
    const nonInboxTracked = status.entries.filter(
      (e) => !e.startsWith("??") && !e.includes(REPO_INBOX_DIR),
    );
    if (status.available && nonInboxTracked.length > 0) {
      throw new Error(
        `Repository has tracked changes outside inbox: ${nonInboxTracked.join(", ")}`,
      );
    }
    const queue = getRepoTaskQueueSnapshot(projectDir);
    return {
      inboxCount: queue.inboxCount,
      needsAttention: queue.inboxCount > 0,
    };
  },
});

const inboxSorterWorkflow: WorkflowDefinitionInput = {
  name: "inbox-sorter",
  description:
    "Process quick inbox captures into normalized tasks, docs, or other durable project artifacts.",
  tags: ["monitored"],
  triggers: [
    {
      event: "autonomy.inbox.available",
      cooldownMs: 30_000,
    },
  ],
  steps: [
    inspectInbox,
    {
      id: "sort-inbox",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectInbox.output(ctx).needsAttention,
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm run validate-tasks -- --min-ready 0", ctx.projectDir),
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
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("sort-inbox"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
  ],
};

export default inboxSorterWorkflow;
