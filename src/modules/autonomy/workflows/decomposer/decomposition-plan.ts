import { z } from "zod";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";

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
  doneWhen: z.array(nonBlankString).min(1),
  sourceIntent: nonBlankString,
  initiative: nonBlankString,
  acceptanceEvidence: z.array(nonBlankString).min(1),
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

export function decodeDecompositionPlan(raw: unknown): DecompositionPlan {
  return decompositionPlanSchema.parse(raw);
}

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
    "doneWhen",
    "sourceIntent",
    "initiative",
    "acceptanceEvidence",
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
    doneWhen: stringArraySchema,
    sourceIntent: { type: "string", minLength: 1 },
    initiative: { type: "string", minLength: 1 },
    acceptanceEvidence: stringArraySchema,
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
