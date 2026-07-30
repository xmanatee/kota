import { runAgentHarness } from "#core/agent-harness/index.js";
import type { WorkflowAgentHarnessRunner } from "../run-types.js";
import type { AgentRunLimiter } from "./agent-run-limiter.js";

export function createWorkflowAgentHarnessRunner(
  limiter: AgentRunLimiter | undefined,
): WorkflowAgentHarnessRunner {
  return async (harness, options, execution = {}) => {
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(execution.signal?.reason);
    if (execution.signal?.aborted) forwardAbort();
    else execution.signal?.addEventListener("abort", forwardAbort, { once: true });

    const run = () =>
      runAgentHarness(
        harness,
        { ...options, abortController },
        execution.writer,
      );
    try {
      if (limiter === undefined) return await run();
      return execution.workspaceKey === undefined
        ? await limiter.run(run, execution.signal)
        : await limiter.runExclusive(
            execution.workspaceKey,
            run,
            execution.signal,
          );
    } finally {
      execution.signal?.removeEventListener("abort", forwardAbort);
    }
  };
}
