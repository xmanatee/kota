import { defineScopedModuleEvent } from "#core/events/scope.js";
import type { AutonomyIssueTransitionKind } from "./autonomy-issue-projection.js";

export type AutonomyIssueDecisionRequest = {
  issueKey: string;
  rootCauseKey: string;
  semanticRevision: number;
  transition: AutonomyIssueTransitionKind;
  observedAt: string;
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
        },
      },
      filterablePaths: [
        "issueKey",
        "rootCauseKey",
        "semanticRevision",
        "transition",
      ],
      sensitivity: "internal",
    },
  );
