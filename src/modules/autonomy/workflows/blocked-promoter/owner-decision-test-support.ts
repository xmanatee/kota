import { join } from "node:path";
import {
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
  setOwnerQuestionQueueInstance,
} from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { createTestRunContext } from "#core/workflow/testing/run-context-fixture.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import workflow from "../blocked-promoter-owner-decision/workflow.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionRequest,
  decodeBlockedOwnerDecisionResolution,
} from "./owner-decision-follow-up.js";

/** Runs the shipped follow-up with a real queue; only the human answer is controlled. */
export async function answerBlockedOwnerRequest(
  root: string,
  request: BlockedOwnerDecisionRequest,
  answer: string,
) {
  const bus = new EventBus();
  const pbus = new ScopedEventBus(bus, deriveDirectoryScopeId(root));
  const queue = new OwnerQuestionQueue(join(root, ".kota", "owner-questions"), pbus);
  setOwnerQuestionQueueInstance(queue);
  let resolution: ReturnType<typeof decodeBlockedOwnerDecisionResolution> | undefined;
  bus.on("owner.question.asked", ({ id }) => {
    setTimeout(() => queue.answer(id, answer, "test-owner"), 0);
  });
  const trigger = {
    event: BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
    schemaRef: null,
    payload: request,
  };
  try {
    const execution = await executeWorkflowRun(
      validateWorkflowDefinitions([
        { ...workflow, definitionPath: "blocked-owner-decision.test" },
      ], root)[0]!,
      trigger,
      {
        runContext: {
          ...createTestRunContext(root, trigger),
          scope: { id: deriveDirectoryScopeId(root), root },
          publications: {
            stageEmit: (_stepId, event, payload) => {
              if (event === BLOCKED_OWNER_DECISION_RESOLVED_EVENT) {
                resolution = decodeBlockedOwnerDecisionResolution(payload);
              }
            },
          },
        },
        bus,
        pbus,
        store: new WorkflowRunStore(root),
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        log: () => undefined,
      },
    ).promise;
    if (execution.metadata.status !== "success" || !resolution) {
      throw new Error(`Owner decision did not resolve: ${JSON.stringify(execution.metadata)}`);
    }
    return { resolution, questions: queue.list() };
  } finally {
    bus.clear();
    resetOwnerQuestionQueue();
  }
}
