import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  runCheck,
  stepCommitRequiresDaemonRestart,
  stepCommitted,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  applyOutcome,
  askStep,
  consumeStep,
  inspectBlocked,
  instructOperatorCapture,
  promoteAfterApproval,
  promoteDeterministic,
  waitStep,
} from "./resolution-steps.js";

const writeBlockerActions = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-blocker-actions",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBlocked.output(ctx);
    return inspection !== undefined && inspection.actions.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectBlocked.outputRequired(ctx);
    const instructions = instructOperatorCapture.output(ctx)?.instructions ?? [];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const filePath = join(ctx.workflow.runDirPath, "blocker-actions.json");
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          actions: inspection.actions,
          operatorCaptureInstructionsEmitted: instructions,
        },
        null,
        2,
      )}\n`,
    );
    return { written: true, path: filePath };
  },
});

function workflowChangedAnything(
  promotions: number,
  followups: number,
  applications: number,
  instructions: number,
): boolean {
  return promotions + followups + applications + instructions > 0;
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    return workflowChangedAnything(
      (promoteDeterministic.output(ctx)?.promotions ?? []).length,
      (promoteAfterApproval.output(ctx)?.promotions ?? []).length,
      (applyOutcome.output(ctx) ?? []).length,
      (instructOperatorCapture.output(ctx)?.instructions ?? []).length,
    );
  },
  run: (ctx) => {
    const deterministic = promoteDeterministic.output(ctx)?.promotions ?? [];
    const followups = promoteAfterApproval.output(ctx)?.promotions ?? [];
    const applications = applyOutcome.output(ctx) ?? [];
    const instructions = instructOperatorCapture.output(ctx)?.instructions ?? [];
    const lines = [
      "blocked-promoter: promote satisfied tasks and refresh blocker markers",
      "",
      ...deterministic.map(
        (move) => `- promote ${move.id}: blocked -> ${move.toState} (precondition satisfied)`,
      ),
      ...followups.map(
        (move) => `- promote ${move.id}: blocked -> ${move.toState} (operator approved)`,
      ),
      ...applications.map((application) =>
        application.kind === "asked"
          ? `- refresh asked marker for slot ${application.slot} at ${application.lastAskedAt}`
          : `- write resolved marker for slot ${application.slot} at ${application.resolvedAt}`,
      ),
      ...instructions.map(
        (instruction) =>
          `- instruct operator capture for ${instruction.taskId} (${instruction.capturePath}, blocked ${instruction.ageDays}d)`,
      ),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const object = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (object.ok !== true) {
      throw new Error(`expected ok: true, got ${String(object.ok)}`);
    }
    return object;
  },
  run: async (ctx) => {
    await runCheck("pnpm run validate-tasks", ctx.projectDir, { signal: ctx.signal });
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    });
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    }),
});

const blockedPromoterWorkflow: WorkflowDefinitionInput = {
  name: "blocked-promoter",
  description:
    "Auto-promote blocked tasks whose typed unblock precondition is satisfied; re-ask owner-decision slots on a 14-day cadence.",
  tags: ["monitored"],
  recoveryCapable: true,
  triggers: [
    { event: "autonomy.queue.available", cooldownMs: 60_000 },
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
          workflowName: "blocked-promoter",
        }),
    },
    inspectBlocked,
    promoteDeterministic,
    askStep,
    waitStep,
    consumeStep,
    applyOutcome,
    promoteAfterApproval,
    instructOperatorCapture,
    writeBlockerActions,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-promoted",
      type: "emit",
      when: (ctx) =>
        stepCommitted("commit")(ctx) &&
        (promoteDeterministic.output(ctx)?.promotions ?? []).length +
          (promoteAfterApproval.output(ctx)?.promotions ?? []).length >
          0,
      event: "autonomy.blocked.promoted",
      payload: (ctx) => {
        const all = [
          ...(promoteDeterministic.output(ctx)?.promotions ?? []),
          ...(promoteAfterApproval.output(ctx)?.promotions ?? []),
        ];
        return {
          runId: ctx.workflow.runId,
          promotedTaskIds: all.map((move) => move.id),
          promotedToReady: all.filter((move) => move.toState === "ready").map((move) => move.id),
          promotedToBacklog: all.filter((move) => move.toState === "backlog").map((move) => move.id),
        };
      },
    },
    {
      id: "emit-operator-capture-instructed",
      type: "emit",
      when: (ctx) =>
        stepCommitted("commit")(ctx) &&
        (instructOperatorCapture.output(ctx)?.instructions ?? []).length > 0,
      event: "autonomy.blocked.operator-capture-instructed",
      payload: (ctx) => ({
        runId: ctx.workflow.runId,
        instructions: (instructOperatorCapture.output(ctx)?.instructions ?? []).map(
          ({ taskId, capturePath, description, ageDays, instructedAt }) => ({
            taskId,
            capturePath,
            description,
            ageDays,
            instructedAt,
          }),
        ),
      }),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "blocked-promoter committed task promotions or owner-ask markers",
      requires: ["commit"],
    },
  ],
};

export default blockedPromoterWorkflow;
