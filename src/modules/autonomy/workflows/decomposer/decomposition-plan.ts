import { z } from "zod";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";
import type { CodeStepOutputValidator } from "#core/workflow/step-input-code.js";

const priorityValues = ["p0", "p1", "p2", "p3"] as const;
const nonBlankString = z.string().trim().min(1);

const decompositionSubtaskSchema = z.object({
  reuseTaskId: z.string().regex(/^task-[a-z0-9][a-z0-9-]*$/).nullable(),
  title: nonBlankString,
  priority: z.enum(priorityValues),
  problem: nonBlankString,
  desiredOutcome: nonBlankString,
  constraints: z.array(nonBlankString).min(1),
  howWeWillKnow: z.array(nonBlankString).min(1),
  dependsOn: z.array(z.number().int().nonnegative()),
}).strict();

const replacementPlanSchema = z.object({
  action: z.literal("replace"),
  rationale: nonBlankString,
  subtasks: z.array(decompositionSubtaskSchema).min(1),
}).strict().superRefine((plan, ctx) => {
  for (const [index, task] of plan.subtasks.entries()) {
    for (const dependencyIndex of task.dependsOn) {
      if (dependencyIndex >= index) {
        ctx.addIssue({
          code: "custom",
          path: ["subtasks", index, "dependsOn"],
          message: "dependencies must refer to an earlier subtask index",
        });
      }
    }
  }
});

export type DecompositionPlan = z.infer<typeof replacementPlanSchema>;
const decompositionPlanSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep"), rationale: nonBlankString }).strict(),
  replacementPlanSchema,
]);
export type DecompositionDecision = z.infer<typeof decompositionPlanSchema>;

export const decodeDecompositionPlan: CodeStepOutputValidator<DecompositionDecision> =
  (raw) => decompositionPlanSchema.parse(raw);

const decompositionReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rationale: nonBlankString,
  issues: z.array(nonBlankString),
}).strict().superRefine((review, ctx) => {
  if (review.decision === "approve" && review.issues.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["issues"],
      message: "approved reviews must not report issues",
    });
  }
  if (review.decision === "reject" && review.issues.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["issues"],
      message: "rejected reviews must report at least one issue",
    });
  }
});

export type DecompositionReview = z.infer<typeof decompositionReviewSchema>;

export const decodeDecompositionReview: CodeStepOutputValidator<DecompositionReview> =
  (raw) => decompositionReviewSchema.parse(raw);

export const decompositionPlanOutputSchema = z.toJSONSchema(decompositionPlanSchema) as JsonSchemaObject;
export const decompositionReviewOutputSchema = z.toJSONSchema(decompositionReviewSchema) as JsonSchemaObject;
