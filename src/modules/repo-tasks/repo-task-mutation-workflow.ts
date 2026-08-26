import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeRepoTaskMutationRequest,
  executeRepoTaskMutationInRun,
  type RepoTaskMutationValue,
  repoTaskMutationResources,
} from "./repo-task-mutation-boundary.js";

function decodeMutationResult(value: unknown): RepoTaskMutationValue {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof (value as Record<string, unknown>).ok !== "boolean"
  ) {
    throw new Error("expected a repo-task mutation result");
  }
  return value as RepoTaskMutationValue;
}

const applyMutation = typedCodeStep<RepoTaskMutationValue>({
  id: "apply-mutation",
  type: "code",
  validate: decodeMutationResult,
  run: ({ repositoryAccess, trigger }) =>
    executeRepoTaskMutationInRun(
      repositoryAccess,
      decodeRepoTaskMutationRequest(trigger.payload.request),
    ),
});

const repoTaskMutationWorkflow: WorkflowDefinitionInput = {
  name: "repo-task-mutation",
  description: "Apply one repository task mutation through the shared writer runtime.",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  resources: ({ projectDir, trigger }) => [
    ...new Set(
      repoTaskMutationResources(
        projectDir,
        decodeRepoTaskMutationRequest(trigger.payload.request),
      ),
    ),
  ].sort(),
  inputSchema: {
    type: "object",
    required: ["request"],
    properties: {
      request: { type: "object" },
      scopeId: { type: "string" },
      projectId: { type: "string" },
      triggeredAt: { type: "string" },
      _runId: { type: "string" },
      triggeredByRunId: { type: "string" },
    },
    additionalProperties: false,
  },
  triggers: [{ event: "repo-task.mutation.requested" }],
  steps: [applyMutation],
};

export default repoTaskMutationWorkflow;
