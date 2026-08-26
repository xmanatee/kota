import { z } from "zod";
import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";

export const ISSUE_DISPOSITION_ACTIONS = [
  "create-task",
  "ask-owner",
  "observe",
  "accept",
  "duplicate",
  "no-action",
] as const;

const issueDispositionSchema = z.object({
  action: z.enum(ISSUE_DISPOSITION_ACTIONS),
  rationale: z.string().min(1),
  taskTitle: z.string(),
  taskSummary: z.string(),
  taskPriority: z.enum(["p0", "p1", "p2", "p3"]),
  taskArea: z.string(),
  taskClass: z.enum(["Product", "Safety", "Platform", "Meta"]),
  taskHowWeWillKnow: z.string(),
  ownerQuestion: z.string(),
  ownerReason: z.string(),
  proposedAnswers: z.array(z.string().min(1)),
  duplicateOfIssueKey: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "create-task") {
    for (const [field, text] of [
      ["taskTitle", value.taskTitle],
      ["taskSummary", value.taskSummary],
      ["taskArea", value.taskArea],
      ["taskHowWeWillKnow", value.taskHowWeWillKnow],
    ] as const) {
      if (!text.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for create-task`,
        });
      }
    }
  }
  if (value.action === "ask-owner") {
    if (!value.ownerQuestion.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerQuestion"],
        message: "ownerQuestion is required for ask-owner",
      });
    }
    if (!value.ownerReason.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerReason"],
        message: "ownerReason is required for ask-owner",
      });
    }
  }
  if (value.action === "duplicate" && !value.duplicateOfIssueKey?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["duplicateOfIssueKey"],
      message: "duplicateOfIssueKey is required for duplicate",
    });
  }
});

export type IssueDisposition = z.infer<typeof issueDispositionSchema>;

export function decodeIssueDisposition(
  value: Parameters<typeof issueDispositionSchema.parse>[0],
): IssueDisposition {
  return issueDispositionSchema.parse(value);
}

export const issueDispositionOutputSchema = {
  type: "object",
  required: [
    "action",
    "rationale",
    "taskTitle",
    "taskSummary",
    "taskPriority",
    "taskArea",
    "taskClass",
    "taskHowWeWillKnow",
    "ownerQuestion",
    "ownerReason",
    "proposedAnswers",
  ],
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: [...ISSUE_DISPOSITION_ACTIONS] },
    rationale: { type: "string" },
    taskTitle: { type: "string" },
    taskSummary: { type: "string" },
    taskPriority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
    taskArea: { type: "string" },
    taskClass: {
      type: "string",
      enum: ["Product", "Safety", "Platform", "Meta"],
    },
    taskHowWeWillKnow: { type: "string" },
    ownerQuestion: { type: "string" },
    ownerReason: { type: "string" },
    proposedAnswers: { type: "array", items: { type: "string" } },
    duplicateOfIssueKey: { type: "string" },
  },
} satisfies JsonSchemaObject;
