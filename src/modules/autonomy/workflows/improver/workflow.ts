import type { AgentDef } from "#core/agents/agent-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { recallForImprover } from "#modules/autonomy/knowledge-recall.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import { writeRunSummary } from "#modules/autonomy/run-summary.js";
import { aggregateRunOutcomes, MONITORED_WORKFLOW_NAMES, runCheck, stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";

/** Minimum interval between improver runs triggered by the same event type. */
export const IMPROVER_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

export const agent: AgentDef = {
  name: "improver",
  role: "Improve the autonomous development system itself using evidence from recent runs.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  model: "claude-opus-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description:
    "Improve the autonomous development system itself using evidence from recent runs.",
  triggers: [
    {
      event: "workflow.build.committed",
      cooldownMs: IMPROVER_COOLDOWN_MS,
    },
    {
      event: "workflow.completed",
      filter: {
        workflow: [...MONITORED_WORKFLOW_NAMES],
        status: ["failed", "interrupted"],
      },
      cooldownMs: IMPROVER_COOLDOWN_MS,
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "gather-run-data",
      type: "code",
      exposeOutputToAgent: true,
      run: () => {
        const store = new WorkflowRunStore();
        return aggregateRunOutcomes(store.runsDir);
      },
    },
    {
      id: "recall-knowledge",
      type: "code",
      exposeOutputToAgent: true,
      run: ({ projectDir }) => recallForImprover(projectDir),
    },
    {
      id: "improve",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      maxTurns: 75,
      timeoutMs: 60 * 60 * 1000, // 60 minutes — improver analysis can be thorough
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      repairLoop: {
        maxRepairAttempts: 3,
        maxTurnsPerRepair: 25,
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm build", ctx.projectDir),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run validate-tasks", ctx.projectDir),
          },
          {
            id: "typecheck",
            type: "code" as const,
            phase: 1,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run typecheck", ctx.projectDir),
          },
          {
            id: "lint",
            type: "code" as const,
            phase: 1,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm run lint:fix && git add -u && pnpm run lint", ctx.projectDir),
          },
          {
            id: "test",
            type: "code" as const,
            phase: 1,
            run: (ctx: WorkflowStepContext) => runCheck("pnpm test", ctx.projectDir, 300_000),
          },
        ],
      },
    },
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("improve"),
      run: ({ projectDir, workflow }: WorkflowStepContext) =>
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
