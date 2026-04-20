/**
 * Operator-facing observer for eval-harness regressions.
 *
 * Subscribes to the typed `eval-harness.regression.detected` event and
 * re-emits the payload as a `workflow.attention.digest` item so the regular
 * notification modules (slack, telegram, email, webhook) surface it through
 * the same channel operators already watch for attention items.
 *
 * This workflow only re-shapes a typed event into the attention envelope —
 * it does not decide whether a regression is real. The cadence owns the
 * gate decision; this bridge owns operator visibility.
 */

import type { WorkflowDefinitionInput } from "#core/workflow/types.js";

type RegressionPayload = {
  baseline: {
    fixtureCount: number;
    repeatCount: number;
    passAtK: number;
    passHatK: number;
  };
  candidate: {
    fixtureCount: number;
    repeatCount: number;
    passAtK: number;
    passHatK: number;
  };
  hostClass: string;
  noiseBandPercentagePoints: number;
  dropPercentagePoints: number;
  runArtifactBaseDir: string;
  reason: string;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildAttentionItemFromRegression(
  payload: RegressionPayload,
): { label: string; detail: string; text: string } {
  const label = "Eval regression";
  const detail =
    `pass^k ${pct(payload.baseline.passHatK)} → ${pct(payload.candidate.passHatK)}` +
    ` (-${payload.dropPercentagePoints.toFixed(2)}pp beyond ${payload.noiseBandPercentagePoints}pp band` +
    `, host "${payload.hostClass}")`;
  const text =
    `Attention digest (1 item):\n• *${label}*: ${detail}\n` +
    `Run artifacts: ${payload.runArtifactBaseDir}\nReason: ${payload.reason}`;
  return { label, detail, text };
}

const evalHarnessRegressionNotify: WorkflowDefinitionInput = {
  name: "eval-harness-regression-notify",
  description:
    "Surface eval-harness regressions through the normal attention channel so operators see a drop without opening run artifacts.",
  triggers: [{ event: "eval-harness.regression.detected" }],
  steps: [
    {
      id: "route-to-attention-digest",
      type: "code",
      run: ({ trigger, emit }) => {
        const payload = trigger.payload as RegressionPayload;
        const item = buildAttentionItemFromRegression(payload);
        emit("workflow.attention.digest", {
          items: [{ label: item.label, detail: item.detail }],
          text: item.text,
        });
      },
    },
  ],
};

export default evalHarnessRegressionNotify;
