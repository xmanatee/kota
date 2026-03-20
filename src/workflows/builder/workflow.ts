import {
  getRepoTaskQueueSnapshot,
  isRepoTaskQueueSnapshot,
} from "../../repo-tasks.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import {
  BUILTIN_WORKFLOW_MODEL,
  createVerificationAndRestartSteps,
} from "../shared.js";
import { claimTask, isClaimTaskResult } from "./claim-task.js";
import { gatherBuilderContext } from "./gather-context.js";
import {
  isBuilderPreflightResult,
  runBuilderPreflight,
} from "./preflight.js";

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "success",
      },
    },
  ],
  steps: [
    {
      id: "inspect-ready-queue",
      type: "code",
      run: ({ projectDir }) => getRepoTaskQueueSnapshot(projectDir),
    },
    {
      id: "preflight",
      type: "code",
      when: ({ previousOutput }) =>
        isRepoTaskQueueSnapshot(previousOutput) &&
        previousOutput.counts.ready > 0,
      run: ({ projectDir }) => runBuilderPreflight(projectDir),
    },
    {
      id: "gather-context",
      type: "code",
      when: ({ previousOutput }) =>
        isBuilderPreflightResult(previousOutput) &&
        previousOutput.validCount > 0,
      run: (ctx) => gatherBuilderContext(ctx),
    },
    {
      id: "claim-task",
      type: "code",
      when: ({ stepOutputs }) =>
        isBuilderPreflightResult(stepOutputs.preflight) &&
        (stepOutputs.preflight as { validCount: number }).validCount > 0,
      run: ({ projectDir }) => claimTask(projectDir),
    },
    {
      id: "build",
      type: "agent",
      promptPath: "src/workflows/builder/prompt.md",
      model: BUILTIN_WORKFLOW_MODEL,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: ({ stepOutputs }) => isClaimTaskResult(stepOutputs["claim-task"]),
    },
    ...createVerificationAndRestartSteps(
      "builder workflow finished verification build",
      "build",
    ),
  ],
};

export default builderWorkflow;
