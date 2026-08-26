import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type {
  AutonomyHealthJsonObject,
  AutonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthReview,
  buildAutonomyHealthReview,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import {
  collectRuntimeHealthAuditOperation,
  type RuntimeHealthAudit,
} from "./runtime-health-audit.js";

export type RuntimeAuditStepOutput = {
  signals: AutonomyHealthSignal[];
  generatedAt: string;
  windowStart: string;
  inspected: RuntimeHealthAudit["inspected"];
  patternCount: number;
  evidenceGapCount: number;
  artifactPath: string;
};

type ReviewOutput = { review: AutonomyHealthReview };

export const AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT =
  "autonomy.runtime-health.audit.scheduled";

export function runtimeHealthAuditStepOutput(
  audit: RuntimeHealthAudit,
  artifactPath: string,
): RuntimeAuditStepOutput {
  return {
    signals: audit.signals,
    generatedAt: audit.generatedAt,
    windowStart: audit.windowStart,
    inspected: audit.inspected,
    patternCount: audit.patterns.length,
    evidenceGapCount: audit.evidenceGaps.length,
    artifactPath,
  };
}

function isRuntimeAuditTrigger(event: string): boolean {
  return (
    event === "schedule" ||
    event === AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT
  );
}

export const buildRuntimeAudit = typedCodeStep<RuntimeAuditStepOutput>({
  id: "build-runtime-audit",
  type: "code",
  when: (ctx) => isRuntimeAuditTrigger(ctx.trigger.event),
  validate: (raw) =>
    expectStructuredOutput<RuntimeAuditStepOutput>(raw, [
      "signals",
      "artifactPath",
      "patternCount",
      "evidenceGapCount",
    ]),
  run: async ({ workspaceRoot, stateDir, scopeRoot, workflow, runBlocking }) => {
    const { audit, artifactPath } = await runBlocking(
      collectRuntimeHealthAuditOperation,
      {
        workspaceRoot,
        stateDir,
        scopeRoot,
        runDirPath: workflow.runDirPath,
        nowIso: new Date().toISOString(),
      },
    );
    return runtimeHealthAuditStepOutput(audit, artifactPath);
  },
});

export const buildReview = typedCodeStep<ReviewOutput>({
  id: "build-review",
  type: "code",
  when: (ctx) =>
    !isRuntimeAuditTrigger(ctx.trigger.event) ||
    buildRuntimeAudit.output(ctx) !== undefined,
  validate: (raw) => expectStructuredOutput<ReviewOutput>(raw, ["review"]),
  run: (ctx) => {
    const generatedAt = new Date().toISOString();
    const runtimeAudit = buildRuntimeAudit.output(ctx);
    if (runtimeAudit) {
      return {
        review: buildAutonomyHealthReviewFromSignals({
          signals: runtimeAudit.signals,
          generatedAt,
          sourceEventName: "autonomy.runtime-health.audit",
          reason: ctx.trigger.event,
          scopeId: ctx.scopeId,
        }),
      };
    }
    return {
      review: buildAutonomyHealthReview({
        triggerPayload: ctx.trigger.payload as AutonomyHealthJsonObject,
        generatedAt,
      }),
    };
  },
});
