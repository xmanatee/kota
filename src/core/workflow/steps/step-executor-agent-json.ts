import { validatePayloadSchema } from "../payload-validator.js";

export class JsonOutputValidationError extends Error {
  constructor(
    message: string,
    readonly validationDetail: string,
  ) {
    super(message);
    this.name = "JsonOutputValidationError";
  }
}

export class JsonOutputParseError extends JsonOutputValidationError {
  constructor(message: string, validationDetail: string) {
    super(message, validationDetail);
    this.name = "JsonOutputParseError";
  }
}

export class JsonSchemaValidationError extends JsonOutputValidationError {
  constructor(message: string, validationDetail: string) {
    super(message, validationDetail);
    this.name = "JsonSchemaValidationError";
  }
}

export function extractJsonOutput(
  stepId: string,
  text: string,
  outputSchema: Record<string, unknown> | undefined,
): unknown {
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (!match) {
    const detail = "no fenced JSON block was found in the response";
    throw new JsonOutputValidationError(
      `Agent step "${stepId}" outputFormat is "json" but no fenced JSON block was found in the response`,
      detail,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    const detail = "the fenced block contains invalid JSON";
    throw new JsonOutputParseError(
      `Agent step "${stepId}" outputFormat is "json" but the fenced block contains invalid JSON`,
      detail,
    );
  }
  if (outputSchema !== undefined) {
    const validationError = validatePayloadSchema(outputSchema, parsed as Record<string, unknown>);
    if (validationError) {
      throw new JsonSchemaValidationError(
        `Agent step "${stepId}" output failed schema validation: ${validationError}`,
        validationError,
      );
    }
  }
  return parsed;
}
