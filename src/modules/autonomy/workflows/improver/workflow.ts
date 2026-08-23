import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { recordAutonomyIssueDispositions } from "#modules/autonomy/autonomy-issue-projection.js";
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
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  AUTONOMY_AGENT_DEFAULTS,
  AUTONOMY_AGENT_HANG_TIMEOUT_MS,
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  type ImproverWorktreeInspection,
  inspectImproverWorktreeOperation,
} from "./blocking-operations.js";
import {
  decodeIssueDisposition,
  type IssueDisposition,
  issueDispositionOutputSchema,
} from "./issue-disposition.js";
import {
  type IssueDecisionInput,
  triggerIssue,
} from "./issue-selection.js";
import { proposalFor } from "./issue-work-proposal.js";

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
  role: "Disposition one durable autonomy issue without editing implementation files.",
  promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

type SelectIssueInput = {
  projectDir: string;
  trigger: WorkflowRunTrigger;
};

export function selectIssueInWorker(
  input: SelectIssueInput,
): IssueDecisionInput {
  return triggerIssue(input);
}

const selectIssueOperation = defineWorkflowBlockingOperation<
  SelectIssueInput,
  IssueDecisionInput
>(import.meta.url, "selectIssueInWorker");

const selectIssue = typedCodeStep<IssueDecisionInput>({
  id: "select-issue",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<IssueDecisionInput>(raw, [
      "eligible",
      "reason",
      "issue",
    ]),
  run: ({ projectDir, trigger, runBlocking }) =>
    runBlocking(selectIssueOperation, { projectDir, trigger }),
});

const inspectWorktree = typedCodeStep<ImproverWorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<ImproverWorktreeInspection>(raw, [
      "dirty",
      "summary",
    ]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectImproverWorktreeOperation, { projectDir }),
});

type ApplyDispositionInput = SelectIssueInput & {
  disposition: IssueDisposition;
  workflowRunId: string;
};

export function applyDispositionInWorker(
  input: ApplyDispositionInput,
): AppliedDisposition {
  const selected = triggerIssue(input);
  if (!selected.eligible || !selected.issue) {
    throw new Error(`stale autonomy issue disposition: ${selected.reason}`);
  }
  const materialized = materializeGeneratedWorkProposal({
    projectDir: input.projectDir,
    proposal: proposalFor(
      selected.issue,
      input.disposition,
      input.workflowRunId,
    ),
  });
  return {
    issueKey: selected.issue.issueKey,
    semanticRevision: selected.issue.semanticRevision,
    disposition: input.disposition,
    materialized,
  };
}

const applyDispositionOperation = defineWorkflowBlockingOperation<
  ApplyDispositionInput,
  AppliedDisposition
>(import.meta.url, "applyDispositionInWorker");

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
  run: (ctx) =>
    ctx.runBlocking(applyDispositionOperation, {
      projectDir: ctx.projectDir,
      trigger: ctx.trigger,
      disposition: decodeIssueDisposition(ctx.stepOutputs["review-issue"]),
      workflowRunId: ctx.workflow.runId,
    }),
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    applyDisposition.output(ctx)?.materialized.touchedTaskQueue === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: async (ctx) => {
    const applied = applyDisposition.outputRequired(ctx);
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
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
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
      policy,
    });
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: stepSucceeded("validate-before-commit"),
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
      policy: taskCommitPolicy(
        applyDisposition.outputRequired(ctx).materialized,
      ),
    }),
});

type RecordDispositionInput = {
  projectDir: string;
  applied: AppliedDisposition;
  decidedAt: string;
};

export function recordDispositionInWorker(
  input: RecordDispositionInput,
): { recorded: true } {
  const taskIds = input.applied.materialized.taskId
    ? [input.applied.materialized.taskId]
    : [];
  const ownerQuestionIds = input.applied.materialized.ownerQuestionId
    ? [input.applied.materialized.ownerQuestionId]
    : [];
  recordAutonomyIssueDispositions({
    projectDir: input.projectDir,
    updates: [
      {
        issueKey: input.applied.issueKey,
        kind:
          input.applied.disposition.action === "create-task"
            ? "task"
            : input.applied.disposition.action === "ask-owner"
              ? "owner-question"
              : input.applied.disposition.action === "resolve"
                ? "resolved"
                : "observed",
        decidedAt: input.decidedAt,
        taskIds,
        ownerQuestionIds,
      },
    ],
  });
  return { recorded: true };
}

const recordDispositionOperation = defineWorkflowBlockingOperation<
  RecordDispositionInput,
  { recorded: true }
>(import.meta.url, "recordDispositionInWorker");

const recordDisposition = typedCodeStep<{ recorded: true }>({
  id: "record-disposition",
  type: "code",
  when: (ctx) => {
    const applied = applyDisposition.output(ctx);
    if (!applied) return false;
    return (
      !applied.materialized.touchedTaskQueue || stepCommitted("commit")(ctx)
    );
  },
  validate: (raw) =>
    expectStructuredOutput<{ recorded: true }>(raw, ["recorded"]),
  run: (ctx) =>
    ctx.runBlocking(recordDispositionOperation, {
      projectDir: ctx.projectDir,
      applied: applyDisposition.outputRequired(ctx),
      decidedAt: new Date().toISOString(),
    }),
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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "improver",
        }),
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
          items: [
            {
              label: "Autonomy issue disposition",
              detail:
                `${applied.issueKey} revision ${applied.semanticRevision}: ` +
                `${applied.disposition.action}`,
            },
          ],
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
