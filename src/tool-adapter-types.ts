// External tool format types — lightweight import path for consumers that only
// need to construct or type-check tool objects without pulling in adapter logic.

export type SimpleTool = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  run: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};

/** Vercel AI SDK tool() format — uses `execute` and Zod/JSON Schema parameters. */
export type VercelAITool = {
  description?: string;
  parameters: unknown; // Zod schema, AI SDK jsonSchema(), or raw JSON Schema
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  group?: string;
};
