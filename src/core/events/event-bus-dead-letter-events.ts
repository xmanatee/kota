import type { ProjectId } from "./project-scope.js";

export type WorkflowDeadLetterBusEvents = {
  "workflow.dead-letter.changed": {
    scopeId: ProjectId;
    projectId: ProjectId;
    id: string;
    type: "event-envelope" | "batch-envelope" | "workflow-dispatch" | "confirmed-action-dispatch";
    status: "open" | "dismissed" | "redriven";
    owningModule: string;
    affectedWorkflowNames: string[];
    workflowName: string | null;
    failureClass:
      | "validation"
      | "execution"
      | "schema"
      | "auth"
      | "provider"
      | "rate_limit"
      | "runtime"
      | "unknown";
    failureReason: string;
    resolutionReason: string | null;
    retryCount: number;
    updatedAt: string;
  };
};
