import type { ScopeId } from "./scope.js";

export type WorkflowDeadLetterBusEvents = {
  "workflow.dead-letter.changed": {
    scopeId: ScopeId;
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
      | "output_contract"
      | "unknown";
    failureReason: string;
    resolutionReason: string | null;
    retryCount: number;
    updatedAt: string;
  };
};
