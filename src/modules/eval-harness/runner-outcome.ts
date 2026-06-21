
import type { FixtureRunOutcome } from "./fixture-run.js";
import type { WorkflowExecutionOutcome } from "./runner-types.js";

export function outcomeFromExecution(
  execution: WorkflowExecutionOutcome,
  predicatesPassed: boolean,
): FixtureRunOutcome {
  switch (execution.kind) {
    case "completed":
      return predicatesPassed ? "pass" : "fail";
    case "timeout":
      return "timeout";
    case "error":
      return "error";
    case "not-started":
      return "configuration-error";
  }
}
