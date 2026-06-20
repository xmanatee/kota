import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export type ScopeImprovementRequest = {
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

export type ScopeImprovementEvidenceReadySourceKind =
  | "file-churn"
  | "task-churn"
  | "failed-run"
  | "dead-letter"
  | "recovery"
  | "repeated-warning"
  | "oversized-source";

export type ScopeImprovementEvidenceReadySource = {
  id: string;
  kind: ScopeImprovementEvidenceReadySourceKind;
  weight: number;
  ref: string;
  summary: string;
};

export type ScopeImprovementEvidenceReadyPayload = {
  generatedAt: string;
  reason: string;
  dedupeSignature: string;
  totalWeight: number;
  evidenceIds: string[];
  sources: ScopeImprovementEvidenceReadySource[];
};

export const scopeImprovementRequested =
  defineProjectScopedModuleEvent<ScopeImprovementRequest>(
    "autonomy.scope-improvement.requested",
    ["reason", "requestedBy", "windowMs"],
    {
      payloadSchema: {
        type: "object",
        properties: {
          reason: { type: "string", required: false },
          requestedBy: { type: "string", required: false },
          windowMs: { type: "number", required: false },
        },
      },
      sensitivity: "internal",
    },
  );

export const scopeImprovementEvidenceReady =
  defineProjectScopedModuleEvent<ScopeImprovementEvidenceReadyPayload>(
    "autonomy.scope-improvement.evidence-ready",
    [
      "generatedAt",
      "reason",
      "dedupeSignature",
      "totalWeight",
      "evidenceIds",
      "sources",
    ],
    {
      payloadSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          generatedAt: { type: "string", format: "date-time" },
          reason: { type: "string" },
          dedupeSignature: { type: "string", filterable: true },
          totalWeight: { type: "number" },
          evidenceIds: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                kind: {
                  type: "string",
                  enum: [
                    "file-churn",
                    "task-churn",
                    "failed-run",
                    "dead-letter",
                    "recovery",
                    "repeated-warning",
                    "oversized-source",
                  ],
                  filterable: true,
                },
                weight: { type: "number" },
                ref: { type: "string" },
                summary: { type: "string" },
              },
            },
          },
        },
      },
      filterablePaths: ["dedupeSignature"],
      sensitivity: "internal",
      examples: [
        {
          name: "failed builder run",
          payload: {
            scopeId: "example-scope",
            projectId: "example-scope",
            generatedAt: "2026-06-20T00:00:00.000Z",
            reason: "weighted scope-improvement evidence: failed-run=1 totalWeight=5",
            dedupeSignature: "scope-evidence:example",
            totalWeight: 5,
            evidenceIds: ["run:2026-06-20T00-00-00-000Z-builder-failed"],
            sources: [
              {
                id: "run:2026-06-20T00-00-00-000Z-builder-failed",
                kind: "failed-run",
                weight: 5,
                ref: ".kota/runs/2026-06-20T00-00-00-000Z-builder-failed/metadata.json",
                summary: "builder run failed",
              },
            ],
          },
        },
      ],
    },
  );
