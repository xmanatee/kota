import type { JsonSchemaObject } from "#core/util/json-schema-validator.js";

const securityFindingEvidenceSchema = {
  type: "object",
  required: ["path", "line", "excerpt"],
  additionalProperties: false,
  properties: {
    path: { type: "string" },
    line: { type: "number" },
    excerpt: { type: "string" },
  },
} satisfies JsonSchemaObject;

const securityInvestigationFindingSchema = {
  type: "object",
  required: [
    "id",
    "candidateId",
    "claim",
    "severity",
    "affectedPath",
    "evidence",
    "recommendedOutcome",
  ],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    candidateId: { type: "string" },
    claim: { type: "string" },
    severity: { type: "string" },
    affectedPath: { type: "string" },
    evidence: {
      type: "array",
      description: "array of evidence objects; do not return a single object",
      items: securityFindingEvidenceSchema,
    },
    recommendedOutcome: { type: "string" },
  },
} satisfies JsonSchemaObject;

export const securityInvestigationOutputSchema = {
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description: "return [] when there are no plausible findings",
      items: securityInvestigationFindingSchema,
    },
  },
} satisfies JsonSchemaObject;

const securityRevalidationVerdictSchema = {
  type: "object",
  required: ["id", "verdict", "rationale"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    verdict: { type: "string" },
    rationale: { type: "string" },
  },
} satisfies JsonSchemaObject;

export const securityRevalidationOutputSchema = {
  type: "object",
  required: ["findings", "summary"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      description: "one verdict for every investigation finding",
      items: securityRevalidationVerdictSchema,
    },
    summary: {
      type: "string",
      description: "top-level revalidation summary is required",
    },
  },
} satisfies JsonSchemaObject;
