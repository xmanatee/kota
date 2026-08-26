import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  applyBacklogPromotionOperation,
  type BacklogInspection,
  inspectBacklogOperation,
  type PromotionMoves,
} from "./blocking-operations.js";

const inspectBacklog = typedCodeStep<BacklogInspection>({
  id: "inspect-backlog",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<BacklogInspection>(raw, ["dirty", "rationale"]),
  run: ({ projectDir, runBlocking }) =>
    runBlocking(inspectBacklogOperation, { projectDir }),
});

type WriteRationaleResult = {
  written: boolean;
  artifactPath: string;
};

const writeRationale = typedCodeStep<WriteRationaleResult>({
  id: "write-rationale",
  type: "code",
  when: (ctx) => {
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

const applyPromotion = typedCodeStep<PromotionMoves>({
  id: "apply-promotion",
  type: "code",
  when: (ctx) => writeRationale.output(ctx)?.written === true,
  validate: (raw) =>
    expectStructuredOutput<PromotionMoves>(raw, ["promotions"]),
  run: (ctx) => {
    const rationale = inspectBacklog.outputRequired(ctx).rationale;
    return ctx.runBlocking(applyBacklogPromotionOperation, {
      projectDir: ctx.projectDir,
      taskIds: rationale.selected.map((selection) => selection.id),
    });
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

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: async (ctx) => {
    await ctx.runCommand({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: ctx.projectDir,
    });
    return { ok: true } as const;
  },
});

const backlogPromoterWorkflow: WorkflowDefinitionInput = {
  name: "backlog-promoter",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Shape the ready/ queue when actionable work runs out: deterministically promote the top backlog task(s) and record the promotion rationale.",
  tags: ["monitored"],
  // Code-only workflow — no agent step. defaultAutonomyMode is omitted
  // because the workflow has no agent step to inherit it.
  triggers: [{ event: "autonomy.queue.needs-promotion", cooldownMs: 60_000 }],
  steps: [
    inspectBacklog,
    writeRationale,
    applyPromotion,
    writeCommitMessage,
    validateChanges,
    {
      id: "emit-promoted",
      type: "emit",
      when: (ctx) => {
        if (validateChanges.output(ctx)?.ok !== true) return false;
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
  ],
};

export default backlogPromoterWorkflow;
