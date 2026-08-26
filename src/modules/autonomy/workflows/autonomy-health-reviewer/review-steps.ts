import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { AutonomyHealthJsonObject } from "#modules/autonomy/health-signal.js";
import {
  type AutonomyHealthReview,
  buildAutonomyHealthReview,
} from "./health-review.js";

type ReviewOutput = { review: AutonomyHealthReview };

export const buildReview = typedCodeStep<ReviewOutput>({
  id: "build-review",
  type: "code",
  validate: (raw) => expectStructuredOutput<ReviewOutput>(raw, ["review"]),
  run: (ctx) => {
    const generatedAt = new Date().toISOString();
    return {
      review: buildAutonomyHealthReview({
        triggerPayload: ctx.trigger.payload as AutonomyHealthJsonObject,
        generatedAt,
      }),
    };
  },
});
