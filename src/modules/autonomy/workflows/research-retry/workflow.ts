import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  AUTONOMY_AGENT_HARNESS,
  AUTONOMY_DISALLOWED_TOOLS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import { listResearchRetryCandidates, type ResearchRetryCandidate } from "./candidates.js";

export const agent: AgentDef = {
  name: "research-retry",
  role:
    "Retry one blocked research task's inaccessible sources using authenticated-browser and rendered-browser tools, then update task state honestly.",
  promptPath: "src/modules/autonomy/workflows/research-retry/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  skills: "all",
  tools: { permissionMode: "bypassPermissions" },
  writeScope: ["data/tasks/", "data/inbox/", "src/modules/autonomy/"],
  settingSources: ["project"],
};

type InspectResult = {
  dirty: boolean;
  candidate: ResearchRetryCandidate | null;
  candidateCount: number;
};

const inspectCandidates = typedCodeStep<InspectResult>({
  id: "inspect-candidates",
  type: "code",
  when: onNormalTrigger,
  exposeOutputToAgent: true,
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const candidates = listResearchRetryCandidates(projectDir);
    return {
      dirty,
      candidate: candidates[0] ?? null,
      candidateCount: candidates.length,
    };
  },
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
      event: "autonomy.queue.available",
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
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
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
      harness: AUTONOMY_AGENT_HARNESS,
      model: agent.model,
      effort: agent.effort,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      when: (ctx) => {
        if (ctx.trigger.event === "runtime.recovered") return false;
        const inspection = inspectCandidates.output(ctx);
        return !inspection.dirty && inspection.candidate !== null;
      },
      repairLoop: {
        checks: [
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("pnpm run validate-tasks", ctx.projectDir),
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
      when: stepSucceeded("retry"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
  ],
};

export default researchRetryWorkflow;
