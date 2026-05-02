/**
 * Operator-facing bridge for live-run evaluator calibration drift.
 *
 * Consumes `evaluator-calibration.regression.detected` and re-emits the
 * payload as `workflow.attention.digest` so the notification modules
 * (slack, telegram, email, webhook) surface it through the same channel
 * operators already watch for attention items.
 *
 * This workflow only reshapes a typed event into the attention envelope —
 * it does not decide whether a calibration regression is real. The monitor
 * owns that gate decision; this bridge owns operator visibility, matching
 * the split already used by `eval-harness-regression-notify`.
 */

import type { WorkflowDefinitionInput } from "#core/workflow/types.js";

type CalibrationRegressionPayload = {
  windowStartMs: number;
  windowEndMs: number;
  totalRuns: number;
  passVerdictCount: number;
  passContradictionCount: number;
  passContradictionRate: number;
  passWithWarningsCount: number;
  passWithWarningsFollowUpCount: number;
  passWithWarningsFollowUpRate: number;
  thresholdRate: number;
  passWithWarningsThresholdRate: number;
  driftKinds: ("pass-contradiction" | "pass-with-warnings-escalation")[];
  repairAction: "noop" | "created" | "recreated" | "promoted" | "skipped";
  reason: string;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describeRepairAction(
  action: CalibrationRegressionPayload["repairAction"],
): string {
  switch (action) {
    case "created":
      return "opened a new repair task in ready/";
    case "recreated":
      return "re-opened the calibration repair task in ready/";
    case "promoted":
      return "promoted the repair task from backlog/ to ready/";
    case "noop":
      return "an existing repair task is already in flight — no new task created";
    case "skipped":
      return "corrective task creation was skipped (worktree dirty or recovery trigger)";
  }
}

export function buildAttentionItemFromCalibration(
  payload: CalibrationRegressionPayload,
): { label: string; detail: string; text: string } {
  const label = "Evaluator calibration drift";
  const driftSummary = payload.driftKinds.length > 0
    ? payload.driftKinds.join(", ")
    : "(no kinds)";
  const detail =
    `${driftSummary}; pass contradiction ${pct(payload.passContradictionRate)} ` +
    `(${payload.passContradictionCount}/${payload.passVerdictCount}) above ` +
    `${pct(payload.thresholdRate)}, pass-with-warnings follow-up ` +
    `${pct(payload.passWithWarningsFollowUpRate)} ` +
    `(${payload.passWithWarningsFollowUpCount}/${payload.passWithWarningsCount}) above ` +
    `${pct(payload.passWithWarningsThresholdRate)}`;
  const text =
    `Attention digest (1 item):\n• *${label}*: ${detail}\n` +
    `Corrective action: ${describeRepairAction(payload.repairAction)}.\n` +
    `Reason: ${payload.reason}`;
  return { label, detail, text };
}

const evaluatorCalibrationNotify: WorkflowDefinitionInput = {
  name: "evaluator-calibration-notify",
  description:
    "Surface evaluator calibration drift through the normal attention channel so operators see a contradiction-rate spike without opening run artifacts.",
  triggers: [{ event: "evaluator-calibration.regression.detected" }],
  steps: [
    {
      id: "route-to-attention-digest",
      type: "code",
      run: ({ trigger, emit }) => {
        const payload = trigger.payload as CalibrationRegressionPayload;
        const item = buildAttentionItemFromCalibration(payload);
        emit("workflow.attention.digest", {
          items: [{ label: item.label, detail: item.detail }],
          text: item.text,
        });
      },
    },
  ],
};

export default evaluatorCalibrationNotify;
