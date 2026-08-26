import { runAgentHarness } from "#core/agent-harness/index.js";
import type { ProcessSpawnObserver } from "#core/execution/process-supervisor.js";
import type { WorkflowAgentHarnessRunner } from "../run-types.js";

export function createWorkflowAgentHarnessRunner(
  onProcessSpawn?: ProcessSpawnObserver,
): WorkflowAgentHarnessRunner {
  return async (harness, options, execution = {}) => {
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(execution.signal?.reason);
    if (execution.signal?.aborted) forwardAbort();
    else execution.signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      return await runAgentHarness(
        harness,
        {
          ...options,
          ...(onProcessSpawn === undefined ? {} : { onProcessSpawn }),
          abortController,
        },
        execution.writer,
      );
    } finally {
      execution.signal?.removeEventListener("abort", forwardAbort);
    }
  };
}
