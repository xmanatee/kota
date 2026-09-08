import {
  BUILDER_TASK_EVENT,
  listBuilderTaskDispatches,
} from "#modules/autonomy/workflows/builder/task-contract.js";
import type { FixtureJsonObject } from "./fixture.js";

/** Bind the authored task identity to the production dispatch contract after materialization. */
export function fixtureWorkflowTrigger(params: {
  workingDir: string;
  workflowName: string;
  builderTaskId?: string;
  triggerEvent?: string;
  triggerPayload?: FixtureJsonObject;
}): { triggerEvent?: string; triggerPayload?: FixtureJsonObject } {
  if (params.workflowName !== "builder") {
    if (params.builderTaskId !== undefined) throw new Error("builderTaskId requires the builder workflow");
    return { triggerEvent: params.triggerEvent, triggerPayload: params.triggerPayload };
  }
  if (params.builderTaskId === undefined || params.triggerPayload !== undefined || params.triggerEvent !== undefined) {
    throw new Error("Builder fixtures must declare builderTaskId instead of a static trigger payload/event");
  }
  const dispatch = listBuilderTaskDispatches(params.workingDir).find(
    (entry) => entry.taskId === params.builderTaskId,
  );
  if (dispatch === undefined) throw new Error(`Fixture task ${params.builderTaskId} is not actionable`);
  return {
    triggerEvent: BUILDER_TASK_EVENT,
    triggerPayload: { ...dispatch, dependsOn: [...dispatch.dependsOn] },
  };
}
