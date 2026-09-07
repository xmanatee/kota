import { defineScopedModuleEvent } from "#core/events/scope.js";
import type { AutonomyIssueTransitionKind } from "./autonomy-issue-projection.js";

export type AutonomyIssueDecisionRequest = {
  issueKey: string;
  rootCauseKey: string;
  semanticRevision: number;
  transition: AutonomyIssueTransitionKind;
  observedAt: string;
  requestKind: "transition" | "reconciliation";
  idempotencyKey: string;
  ownerFingerprint?: string;
};

export type AutonomyIssueReconciliationRequest = {
  reason:
    | "workflow-runtime-started"
    | "workflow-completed"
    | "owner-decision-resolved";
  requestedAt: string;
};

export const autonomyIssueDecisionRequested =
  defineScopedModuleEvent<AutonomyIssueDecisionRequest>(
    "autonomy.issue.decision-requested",
    [
      "issueKey",
      "rootCauseKey",
      "semanticRevision",
      "transition",
      "observedAt",
      "requestKind",
      "idempotencyKey",
      "ownerFingerprint",
    ],
    {
      payloadSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          issueKey: { type: "string", filterable: true },
          rootCauseKey: { type: "string", filterable: true },
          semanticRevision: { type: "number", filterable: true },
          transition: {
            type: "string",
            enum: ["opened", "repeated", "revised", "cleared", "reopened", "replayed"],
            filterable: true,
          },
          observedAt: { type: "string", format: "date-time" },
          requestKind: {
            type: "string",
            enum: ["transition", "reconciliation"],
            filterable: true,
          },
          idempotencyKey: { type: "string" },
          ownerFingerprint: { type: "string", required: false },
        },
      },
      filterablePaths: [
        "issueKey",
        "rootCauseKey",
        "semanticRevision",
        "transition",
        "requestKind",
      ],
      sensitivity: "internal",
    },
  );

export function autonomyIssueInvestigationKey(
  issueKey: string,
  semanticRevision: number,
  attempt: number,
): string {
  return `autonomy-issue-investigation:${issueKey}:${semanticRevision}:${attempt}`;
}

export const autonomyIssueReconciliationRequested =
  defineScopedModuleEvent<AutonomyIssueReconciliationRequest>(
    "autonomy.issue.reconciliation-requested",
    ["reason", "requestedAt"],
    {
      payloadSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: {
            type: "string",
            enum: [
              "workflow-runtime-started",
              "workflow-completed",
              "owner-decision-resolved",
            ],
            filterable: true,
          },
          requestedAt: { type: "string", format: "date-time" },
        },
      },
      filterablePaths: ["reason"],
      sensitivity: "internal",
    },
  );
