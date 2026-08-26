import type { AgentHarnessResult } from "#core/agent-harness/index.js";
import type { WorkflowAgentStepOutputValidationContext } from "../step-input-base.js";
import { WorkflowStepOutputValidationError } from "../step-input-code.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowStepOutput } from "./step-executor-agent.js";
import {
  extractJsonOutput,
  JsonOutputParseError,
  JsonOutputValidationError,
  JsonSchemaValidationError,
} from "./step-executor-agent-json.js";

export function validateAgentStepOutput(
  step: WorkflowAgentStep,
  output: WorkflowStepOutput,
  context: WorkflowAgentStepOutputValidationContext,
): WorkflowStepOutput {
  if (step.validate === undefined) return output;
  try {
    return step.validate(output, context) as WorkflowStepOutput;
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    throw new WorkflowStepOutputValidationError(step.id, "run", cause);
  }
}

export function parseJsonAgentStepOutput(
  step: WorkflowAgentStep,
  text: string,
): WorkflowStepOutput {
  return extractJsonOutput(step.id, text, step.outputSchema) as WorkflowStepOutput;
}

export function jsonAgentOutputFeedback(error: Error): string | undefined {
  if (error instanceof JsonSchemaValidationError) {
    return `Previous output failed schema validation: ${error.validationDetail}\nPlease include all required fields in your JSON block and try again.`;
  }
  if (error instanceof JsonOutputParseError) {
    return `Previous JSON output was invalid: ${error.validationDetail}\nEnd with one fenced valid JSON block that matches the requested schema, then try again.`;
  }
  if (error instanceof JsonOutputValidationError) {
    return `Previous output was missing usable structured JSON: ${error.validationDetail}\nEnd with one fenced valid JSON block that matches the requested schema, then try again.`;
  }
  if (error instanceof WorkflowStepOutputValidationError) {
    return `Previous structured output failed workflow validation: ${error.cause.message}\nCorrect the JSON using only the provided workflow evidence, then try again.`;
  }
  return undefined;
}

export function workflowOutputFromHarnessResult(
  result: AgentHarnessResult,
): WorkflowStepOutput {
  return {
    content: result.text,
    sessionId: result.sessionId,
    turns: result.turns,
    subtype: result.subtype,
  };
}
