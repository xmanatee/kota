import type { AgentDef } from "../../../../agent-types.js";
import { getRepoTaskQueueSnapshot } from "../../../../repo-tasks.js";
import { assertRepoWorktreeClean } from "../../../../repo-worktree.js";
import type { WorkflowDefinitionInput } from "../../../../workflow/types.js";
import { typedCodeStep } from "../../../../workflow/types.js";
import { commitWorkflowChanges } from "../../commit.js";
import { runCheck, stepSucceeded } from "../../shared.js";

export const agent: AgentDef = {
  name: "inbox-sorter",
  role: "Turn quick inbox captures into the right durable project artifacts.",
  promptPath: "src/modules/autonomy/workflows/inbox-sorter/prompt.md",
  model: "claude-sonnet-4-6",
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
    assertRepoWorktreeClean(projectDir);
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
      timeoutMs: 45 * 60 * 1000,
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectInbox.output(ctx).needsAttention,
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm run validate-tasks -- --min-ready 0", ctx.projectDir),
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
