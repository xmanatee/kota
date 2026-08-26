import { z } from "zod";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";
import type { CodeStepOutputValidator } from "#core/workflow/step-input-code.js";

const taskClassValues = ["Product", "Safety", "Platform", "Meta"] as const;
const priorityValues = ["p0", "p1", "p2", "p3"] as const;
const nonBlankString = z.string().trim().min(1);

const decompositionSubtaskSchema = z.object({
  title: nonBlankString,
  summary: nonBlankString,
  priority: z.enum(priorityValues),
  area: nonBlankString,
  taskClass: z.enum(taskClassValues),
  problem: nonBlankString,
  desiredOutcome: nonBlankString,
  constraints: z.array(nonBlankString).min(1),
  howWeWillKnow: z.array(nonBlankString).min(1),
  dependsOn: z.array(z.number().int().nonnegative()),
}).strict();

const decompositionPlanSchema = z.object({
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

export type DecompositionPlan = z.infer<typeof decompositionPlanSchema>;

export const decodeDecompositionPlan: CodeStepOutputValidator<DecompositionPlan> =
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

const stringArraySchema = {
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
} satisfies JsonSchemaObject;

const subtaskOutputSchema = {
  type: "object",
  required: [
    "title",
    "summary",
    "priority",
    "area",
    "taskClass",
    "problem",
    "desiredOutcome",
    "constraints",
    "howWeWillKnow",
    "dependsOn",
  ],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    priority: { type: "string", enum: [...priorityValues] },
    area: { type: "string", minLength: 1 },
    taskClass: { type: "string", enum: [...taskClassValues] },
    problem: { type: "string", minLength: 1 },
    desiredOutcome: { type: "string", minLength: 1 },
    constraints: stringArraySchema,
    howWeWillKnow: stringArraySchema,
    dependsOn: {
      type: "array",
      items: { type: "number", minimum: 0 },
    },
  },
} satisfies JsonSchemaObject;

export const decompositionPlanOutputSchema = {
  type: "object",
  required: ["rationale", "subtasks"],
  additionalProperties: false,
  properties: {
    rationale: { type: "string", minLength: 1 },
    subtasks: {
      type: "array",
      minItems: 1,
      items: subtaskOutputSchema,
    },
  },
} satisfies JsonSchemaObject;

export const decompositionReviewOutputSchema = {
  type: "object",
  required: ["decision", "rationale", "issues"],
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["approve", "reject"] },
    rationale: { type: "string", minLength: 1 },
    issues: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
} satisfies JsonSchemaObject;
