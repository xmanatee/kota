import { validatePayloadSchema } from "../payload-validator.js";

export class JsonSchemaValidationError extends Error {
  constructor(
    message: string,
    readonly validationDetail: string,
  ) {
    super(message);
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
    throw new Error(
      `Agent step "${stepId}" outputFormat is "json" but no fenced JSON block was found in the response`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error(
      `Agent step "${stepId}" outputFormat is "json" but the fenced block contains invalid JSON`,
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
