import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";

const reviewClaimOutputSchema = {
  type: "object",
  required: ["id", "claim", "evidenceIds", "confidence"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    claim: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
  },
} satisfies JsonSchemaObject;

const reviewFollowUpTaskOutputSchema = {
  type: "object",
  required: [
    "title",
    "summary",
    "priority",
    "area",
    "evidenceIds",
    "acceptanceEvidence",
  ],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    priority: {
      type: "string",
      enum: ["p0", "p1", "p2", "p3"],
    },
    area: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
    acceptanceEvidence: { type: "string" },
  },
} satisfies JsonSchemaObject;

const reviewFindingGroupOutputSchema = {
  type: "object",
  required: ["claims", "followUpTasks"],
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      items: reviewClaimOutputSchema,
    },
    followUpTasks: {
      type: "array",
      items: reviewFollowUpTaskOutputSchema,
    },
  },
} satisfies JsonSchemaObject;

export const progressReviewOutputSchema = {
  type: "object",
  required: ["verdict", "summary", "findings", "ownerQuestions"],
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: [
        "on-track",
        "needs-steering",
        "blocked",
        "insufficient-evidence",
      ],
    },
    summary: { type: "string" },
    findings: {
      type: "object",
      required: ["crossScope", "localScope"],
      additionalProperties: false,
      properties: {
        crossScope: reviewFindingGroupOutputSchema,
        localScope: reviewFindingGroupOutputSchema,
      },
    },
    ownerQuestions: {
      type: "array",
      items: {
        type: "object",
        required: ["topicKey", "question", "reason", "evidenceIds"],
        additionalProperties: false,
        properties: {
          topicKey: { type: "string", pattern: "^[a-z0-9][a-z0-9:_-]*$" },
          question: { type: "string" },
          reason: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
          proposedAnswers: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} satisfies JsonSchemaObject;
