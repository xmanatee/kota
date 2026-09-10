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

const securityInvestigationFindingSchema: JsonSchemaObject = {
  type: "object",
  required: [
    "id",
    "candidateId",
    "evidenceLineage", "existingTaskId", "productionOwner", "violatedInvariant", "repair", "exploitPreconditions", "evidenceIdentity",
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
    existingTaskId: { type: ["string", "null"] },
    productionOwner: { type: "string" },
    violatedInvariant: { type: "string" },
    repair: { type: "string" },
    exploitPreconditions: { type: "string" },
    evidenceIdentity: { type: "string" },
    evidenceLineage: { anyOf: [{ type: "null" }, {
      type: "object", required: ["kind", "reference", "rationale"], additionalProperties: false,
      properties: { kind: { enum: ["unchanged", "new-variant", "regression"] }, reference: { type: "string" }, rationale: { type: "string" } },
    }] } satisfies JsonSchemaObject,
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

export const securityInvestigationOutputSchema: JsonSchemaObject = {
  type: "object",
  required: ["findings", "coverage"],
  additionalProperties: false,
  properties: {
    coverage: {
      type: "array",
      items: { anyOf: [
        { type: "object", required: ["path", "disposition", "rationale"], additionalProperties: false,
          properties: { path: { type: "string" }, disposition: { enum: ["reviewed", "unreviewed"] }, rationale: { type: "string" } } },
        { type: "object", required: ["path", "disposition", "rationale", "prerequisitePaths"], additionalProperties: false,
          properties: { path: { type: "string" }, disposition: { const: "unavailable" }, rationale: { type: "string" }, prerequisitePaths: { type: "array", items: { type: "string" } } } },
      ] },
    },
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
