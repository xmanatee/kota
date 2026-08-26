import { vi } from "vitest";
import type { ScopeRuntime } from "./scope-runtime.js";

export function mockPendingWorkflowBuffers(
  runtime: ScopeRuntime,
  scopeId: string,
): () => void {
  const runtimeState = runtime.workflowRuntime.getState();
  const pendingWatchBuffers = vi
    .spyOn(runtime.workflowRuntime, "listPendingWatchTriggerBuffers")
    .mockReturnValue([{
      workflowName: "pending-scope-work",
      triggerIndex: 0,
      files: ["data/tasks/ready/pending.md"],
    }]);
  const getState = vi.spyOn(runtime.workflowRuntime, "getState").mockReturnValue({
    ...runtimeState,
    pendingRuns: [{
      workflowName: "pending-scope-work",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      enqueuedAtMs: 123,
      notBeforeMs: 123,
    }],
    batchBuffers: {
      "pending-scope-work:0:scope-b:all": {
        definitionName: "pending-scope-work",
        triggerIndex: 0,
        sourceEventName: "test.pending-scope-work",
        scopeId,
        groupingKey: "all",
        groupValues: [],
        firstEventAt: "2026-08-01T12:00:00.000Z",
        lastEventAt: "2026-08-01T12:00:00.000Z",
        inputEvents: [{
          event: "test.pending-scope-work",
          schemaRef: null,
          receivedAt: "2026-08-01T12:00:00.000Z",
          payload: { scopeId },
        }],
        droppedInputCount: 0,
      },
    },
  });

  return () => {
    getState.mockRestore();
    pendingWatchBuffers.mockRestore();
  };
}
