import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";
import {
  type MoveTaskResult,
  moveTaskById,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  buildPromotionRationale,
  PROMOTION_BATCH_LIMIT,
  type PromotionRationale,
} from "./promotion.js";

type Inspection = {
  dirty: boolean;
  rationale: PromotionRationale;
};

const inspectBacklog = typedCodeStep<Inspection>({
  id: "inspect-backlog",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) =>
    expectStructuredOutput<Inspection>(raw, ["dirty", "rationale"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    const dirty = worktree.available && worktree.trackedDirty;
    const rationale = buildPromotionRationale(projectDir, {
      batchLimit: PROMOTION_BATCH_LIMIT,
    });
    return { dirty, rationale };
  },
});

type WriteRationaleResult = {
  written: boolean;
  artifactPath: string;
};

const writeRationale = typedCodeStep<WriteRationaleResult>({
  id: "write-rationale",
  type: "code",
  when: (ctx) => {
    if (ctx.trigger.event === "runtime.recovered") return false;
    const inspection = inspectBacklog.outputRequired(ctx);
    return !inspection.dirty && inspection.rationale.selected.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<WriteRationaleResult>(raw, ["written", "artifactPath"]),
  run: (ctx) => {
    const rationale = inspectBacklog.outputRequired(ctx).rationale;
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const artifactPath = join(ctx.workflow.runDirPath, "promotion-rationale.json");
    writeFileSync(artifactPath, `${JSON.stringify(rationale, null, 2)}\n`);
    return { written: true, artifactPath };
  },
});

type PromotionMoves = {
  promotions: MoveTaskResult[];
};

const applyPromotion = typedCodeStep<PromotionMoves>({
  id: "apply-promotion",
  type: "code",
  when: (ctx) => writeRationale.output(ctx)?.written === true,
  validate: (raw) =>
    expectStructuredOutput<PromotionMoves>(raw, ["promotions"]),
  run: (ctx) => {
    const rationale = inspectBacklog.outputRequired(ctx).rationale;
    const promotions: MoveTaskResult[] = [];
    for (const selection of rationale.selected) {
      promotions.push(moveTaskById(ctx.projectDir, selection.id, "ready"));
    }
    return { promotions };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => (applyPromotion.output(ctx)?.promotions ?? []).length > 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const rationale = inspectBacklog.outputRequired(ctx).rationale;
    const promotions = applyPromotion.outputRequired(ctx).promotions;
    const lines: string[] = [
      `backlog-promoter: promote ${promotions.length} backlog task(s) to ready/`,
      "",
    ];
    for (const move of promotions) {
      const pick = rationale.selected.find((s) => s.id === move.id);
      const detail = pick ? ` — ${pick.reason}` : "";
      lines.push(`- promote ${move.id}: ${move.fromState} -> ${move.toState}${detail}`);
    }
    if (rationale.summary) {
      lines.push("");
      lines.push(rationale.summary);
    }
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
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
});

const backlogPromoterWorkflow: WorkflowDefinitionInput = {
  name: "backlog-promoter",
  description:
    "Shape the ready/ queue when actionable work runs out: deterministically promote the top backlog task(s) and commit a recorded promotion rationale.",
  tags: ["monitored"],
  recoveryCapable: true,
  // Code-only workflow — no agent step. defaultAutonomyMode is omitted
  // because the workflow has no agent step to inherit it.
  triggers: [
    {
      event: "autonomy.queue.needs-promotion",
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
        resetWorktreeForRecovery({ projectDir, workflowName: "backlog-promoter" }),
    },
    inspectBacklog,
    writeRationale,
    applyPromotion,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-promoted",
      type: "emit",
      when: (ctx) => {
        if (!stepCommitted("commit")(ctx)) return false;
        return (applyPromotion.output(ctx)?.promotions ?? []).length > 0;
      },
      event: "autonomy.backlog.promoted",
      payload: (ctx) => {
        const promotions = applyPromotion.output(ctx)?.promotions ?? [];
        return {
          runId: ctx.workflow.runId,
          promotedTaskIds: promotions.map((m) => m.id),
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "backlog-promoter committed task promotions",
      requires: ["commit"],
    },
  ],
};

export default backlogPromoterWorkflow;
