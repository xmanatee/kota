import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
} from "#modules/autonomy/commit.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  type GeneratedWorkProposalResult,
  generatedWorkTaskMutationPaths,
  materializeGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  decodeIssueDisposition,
  type IssueDisposition,
  issueDispositionOutputSchema,
} from "./issue-disposition.js";
import {
  selectIssue,
  triggerIssue,
} from "./issue-selection.js";
import { proposalFor } from "./issue-work-proposal.js";

type WorktreeInspection = { dirty: boolean };

type AppliedDisposition = {
  issueKey: string;
  semanticRevision: number;
  disposition: IssueDisposition;
  materialized: GeneratedWorkProposalResult;
};

function taskCommitPolicy(materialized: GeneratedWorkProposalResult) {
  return {
    kind: "exact-paths" as const,
    paths: generatedWorkTaskMutationPaths(materialized.actions),
  };
}

export const agent: AgentDef = {
  name: "improver",
  role:
    "Disposition one durable autonomy issue without editing implementation files.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const status = getRepoWorktreeStatus(projectDir);
    return { dirty: status.available && status.dirty };
  },
});

const applyDisposition = typedCodeStep<AppliedDisposition>({
  id: "apply-disposition",
  type: "code",
  when: stepSucceeded("review-issue"),
  validate: (raw) =>
    expectStructuredOutput<AppliedDisposition>(raw, [
      "issueKey",
      "semanticRevision",
      "disposition",
      "materialized",
    ]),
  run: (ctx) => {
    const selected = triggerIssue(ctx);
    if (!selected.eligible || !selected.issue) {
      throw new Error(`stale autonomy issue disposition: ${selected.reason}`);
    }
    const disposition = decodeIssueDisposition(ctx.stepOutputs["review-issue"]);
    const materialized = materializeGeneratedWorkProposal({
      projectDir: ctx.projectDir,
      proposal: proposalFor(selected.issue, disposition, ctx.workflow.runId),
    });
    return {
      issueKey: selected.issue.issueKey,
      semanticRevision: selected.issue.semanticRevision,
      disposition,
      materialized,
    };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    applyDisposition.output(ctx)?.materialized.touchedTaskQueue === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const applied = applyDisposition.outputRequired(ctx);
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `improver: materialize ${applied.issueKey} disposition\n`,
      "utf-8",
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: stepSucceeded("write-commit-message"),
  validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
  run: async (ctx) => {
    const policy = taskCommitPolicy(
      applyDisposition.outputRequired(ctx).materialized,
    );
    await runCheck("pnpm run validate-tasks", ctx.projectDir, {
      signal: ctx.signal,
    });
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir, policy);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: stepSucceeded("validate-before-commit"),
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    commitWorkflowChanges(
      ctx.projectDir,
      ctx.workflow.runDirPath,
      taskCommitPolicy(applyDisposition.outputRequired(ctx).materialized),
    ),
});

const recordDisposition = typedCodeStep<{ recorded: true }>({
  id: "record-disposition",
  type: "code",
  when: (ctx) => {
    const applied = applyDisposition.output(ctx);
    if (!applied) return false;
    return !applied.materialized.touchedTaskQueue || stepCommitted("commit")(ctx);
  },
  validate: (raw) =>
    expectStructuredOutput<{ recorded: true }>(raw, ["recorded"]),
  run: (ctx) => {
    const applied = applyDisposition.outputRequired(ctx);
    const taskIds = applied.materialized.taskId
      ? [applied.materialized.taskId]
      : [];
    const ownerQuestionIds = applied.materialized.ownerQuestionId
      ? [applied.materialized.ownerQuestionId]
      : [];
    recordAutonomyIssueDispositions({
      projectDir: ctx.projectDir,
      updates: [{
        issueKey: applied.issueKey,
        kind:
          applied.disposition.action === "create-task"
            ? "task"
            : applied.disposition.action === "ask-owner"
            ? "owner-question"
            : applied.disposition.action === "resolve"
            ? "resolved"
            : "observed",
        decidedAt: new Date().toISOString(),
        taskIds,
        ownerQuestionIds,
      }],
    });
    return { recorded: true } as const;
  },
});

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description:
    "Disposition one new or materially revised durable autonomy issue and route implementation through generated work.",
  recoveryCapable: true,
  defaultAutonomyMode: "autonomous",
  triggers: [
    { event: autonomyIssueDecisionRequested.name },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "improver" }),
    },
    inspectWorktree,
    selectIssue,
    {
      id: "review-issue",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      tier: AUTONOMY_AGENT_DEFAULTS.tier,
      effort: AUTONOMY_AGENT_DEFAULTS.effort,
      timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
      outputFormat: "json",
      outputSchema: issueDispositionOutputSchema,
      validate: decodeIssueDisposition,
      when: (ctx) =>
        selectIssue.output(ctx)?.eligible === true &&
        inspectWorktree.output(ctx)?.dirty === false,
    },
    applyDisposition,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    recordDisposition,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) =>
        stepSucceeded("record-disposition")(ctx) &&
        applyDisposition.output(ctx)?.disposition.action !== "observe",
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const applied = applyDisposition.outputRequired(ctx);
        return {
          items: [{
            label: "Autonomy issue disposition",
            detail:
              `${applied.issueKey} revision ${applied.semanticRevision}: ` +
              `${applied.disposition.action}`,
          }],
          text:
            `Autonomy issue ${applied.issueKey} revision ${applied.semanticRevision} ` +
            `was dispositioned as ${applied.disposition.action}: ` +
            applied.disposition.rationale,
        };
      },
    },
  ],
};

export { issueDispositionOutputSchema };
export default improverWorkflow;
